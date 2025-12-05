import base64
import asyncio
import httpx
import os
import json
import logging
from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, Depends, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy import create_engine, Column, String, Integer, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from datetime import datetime, timedelta

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from fastapi.staticfiles import StaticFiles
from PIL import Image
import io

app = FastAPI(title="Product Scene Generator API")

# Mount uploads directory
os.makedirs("/app/uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="/app/uploads"), name="uploads")

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Database Setup ---
# User provided: banana_db / banana_db / ***REDACTED_DB_PASSWORD*** / 1Panel-postgresql-SJJE:5432
DATABASE_URL = "postgresql://banana_db:***REDACTED_DB_PASSWORD***@1Panel-postgresql-SJJE:5432/banana_db"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

from passlib.context import CryptContext
from jose import JWTError, jwt

# --- Auth Config ---
SECRET_KEY = "banana-product-secret-key-change-this-in-prod"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 1 day

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# --- Data Models ---
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    role = Column(String, default="user") # 'admin', 'user'
    created_at = Column(DateTime, default=datetime.utcnow)

class ImageGenerationLog(Base):
    __tablename__ = "image_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer)
    count = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)

class SystemConfig(Base):
    __tablename__ = "system_config"
    key = Column(String, primary_key=True, index=True)
    value = Column(String)

class VideoQueueItem(Base):
    __tablename__ = "video_queue"
    id = Column(String, primary_key=True, index=True)
    filename = Column(String)
    file_path = Column(String)
    prompt = Column(String)
    status = Column(String, default="pending") # pending, processing, done, error
    result_url = Column(String, nullable=True)
    error_msg = Column(String, nullable=True)
    user_id = Column(Integer, nullable=True) # Linked to User
    created_at = Column(DateTime, default=datetime.now)

    @property
    def preview_url(self):
        if self.file_path:
            # /app/uploads/queue/xxx -> /uploads/queue/xxx
            # Ensure we handle the path correctly. 
            # If file_path is /app/uploads/queue/123.jpg, we want /uploads/queue/123.jpg
            if self.file_path.startswith("/app/uploads"):
                return self.file_path.replace("/app/uploads", "/uploads")
        return None

# Create tables
try:
    Base.metadata.create_all(bind=engine)
except Exception as e:
    logger.error(f"Database connection failed: {e}")

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Data Models ---
class ImageResult(BaseModel):
    angle_name: str
    image_base64: Optional[str] = None
    video_prompt: Optional[str] = None
    error: Optional[str] = None

class ConfigItem(BaseModel):
    api_url: str
    api_key: str
    model_name: str
    video_api_url: Optional[str] = None
    video_api_key: Optional[str] = None
    video_model_name: Optional[str] = None
    app_url: Optional[str] = None
    analysis_model_name: Optional[str] = None
# --- Prompt Matrix ---
ANGLES_PROMPTS = {
    "01_Front_View": "Generate a photorealistic front-view product shot. The product should be centered, facing the camera directly. Lighting should highlight the main features.",
    "02_Side_View_45": "Generate a 3/4 angle product shot (45-degree turn). Show the depth and side profile of the product clearly.",
    "03_Top_Down_View": "Generate a top-down flat lay view of the product. The camera is looking straight down.",
    "04_Low_Angle_Hero": "Generate a low-angle 'hero' shot, looking up at the product to make it look imposing and premium.",
    "05_Close_Up_Detail": "Generate a macro close-up shot focusing on the texture and material quality of the product. Shallow depth of field.",
    "06_Lifestyle_Usage": "Generate a lifestyle scene showing the product being used or placed naturally in the environment.",
    "07_Back_View": "Generate a rear view of the product to show the back design details.",
    "08_Floating_Composition": "Generate a creative shot where the product is slightly floating or tilted dynamically to add energy.",
    "09_Atmospheric_Wide": "Generate a wider shot showing the product fully integrated into the background environment with dramatic lighting."
}

# --- Auth Logic ---
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/login")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

async def get_current_admin(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    return current_user

# Startup: Create Admin
@app.on_event("startup")
def startup_event():
    db = SessionLocal()
    try:

        admin_user = os.getenv("ADMIN_USER", "admin")
        admin_pass = os.getenv("ADMIN_PASSWORD", "***REDACTED_ADMIN_PASSWORD***")
        
        # Check if admin user exists
        user = db.query(User).filter(User.username == admin_user).first()
        if not user:
            print(f"Creating default admin user: {admin_user}...")
            admin = User(
                username=admin_user,
                hashed_password=get_password_hash(admin_pass),
                role="admin"
            )
            db.add(admin)
            db.commit()
        else:
            # Always update password to match ENV (so user can reset via ENV)
            print(f"Updating admin user password for: {admin_user}")
            user.hashed_password = get_password_hash(admin_pass)
            # Ensure role is admin
            user.role = "admin"
            db.commit()
    finally:
        db.close()

# Login Endpoint
class Token(BaseModel):
    access_token: str
    token_type: str
    username: str
    role: str

@app.post("/api/v1/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role, "uid": user.id},
        expires_delta=access_token_expires
    )
    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "username": user.username,
        "role": user.role
    }

# Backward compatibility alias for dependency injection
# Many endpoints rely on 'token: str = Depends(verify_token)'
# We should update them to use 'current_user: User = Depends(get_current_user)'
# BUT to minimize immediate refactoring, we can make verify_token return the user or token?
# Existing code expects verify_token -> str.
# Strategy: Update key endpoints, but leave this as a wrapper if possible?
# Actually, the quickest way is to Replace 'verify_token' usage in endpoints with 'get_current_user'.
# But there are many endpoints.
# Let's redefine verify_token to valid JWT and return the token string (preserving old behavior but adding validation).

def verify_token(token: str = Depends(oauth2_scheme)):
    try:
        jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return token
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
             headers={"WWW-Authenticate": "Bearer"},
        )

# --- User Manage Models ---
class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "user"

class UserUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None

class UserOut(BaseModel):
    id: int
    username: str
    role: str
    created_at: datetime
    class Config:
        orm_mode = True

class StatsResponse(BaseModel):
    by_day: List[dict]
    by_week: List[dict]
    by_month: List[dict]
    user_stats: List[dict]

# --- Admin Endpoints ---

@app.get("/api/v1/users", response_model=List[UserOut])
def get_users(db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    return db.query(User).all()

@app.post("/api/v1/users", response_model=UserOut)
def create_user(user: UserCreate, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_password = get_password_hash(user.password)
    new_user = User(username=user.username, hashed_password=hashed_password, role=user.role)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.put("/api/v1/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, user: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user.username:
        db_user.username = user.username
    if user.password:
        db_user.hashed_password = get_password_hash(user.password)
    # Only allow role change if not self or careful logic? Allow for now.
    if user.role:
        db_user.role = user.role
        
    db.commit()
    db.refresh(db_user)
    return db_user

from sqlalchemy import func

@app.get("/api/v1/stats")
def get_stats(db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    # 1. User Summary Stats (Total Counts)
    users = db.query(User).all()
    user_stats = []
    
    for u in users:
        img_count = db.query(ImageGenerationLog).filter(ImageGenerationLog.user_id == u.id).count()
        vid_count = db.query(VideoQueueItem).filter(VideoQueueItem.user_id == u.id).count()
        user_stats.append({
            "username": u.username,
            "role": u.role,
            "image_count": img_count,
            "video_count": vid_count
        })

    # 2. Daily Activity (Last 30 Days)
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    
    # SQLite uses strftime or date function. func.date works in most.
    # Group by Date only (All users combined) for the main chart
    img_daily = db.query(
        func.date(ImageGenerationLog.created_at).label('date'),
        func.count(ImageGenerationLog.id).label('count')
    ).filter(ImageGenerationLog.created_at >= thirty_days_ago).group_by('date').all()
    
    vid_daily = db.query(
        func.date(VideoQueueItem.created_at).label('date'),
        func.count(VideoQueueItem.id).label('count')
    ).filter(VideoQueueItem.created_at >= thirty_days_ago).group_by('date').all()

    # Format for JSON
    by_day_img = [{"date": str(r.date), "count": r.count, "type": "image"} for r in img_daily]
    by_day_vid = [{"date": str(r.date), "count": r.count, "type": "video"} for r in vid_daily]

    return {
        "user_stats": user_stats,
        "by_day": by_day_img + by_day_vid,
        "by_week": [], # Placeholder
        "by_month": [] # Placeholder
    }
    
    # For Detailed Charts (Day/Week/Month), maybe return raw list of recent activity?
    # Or implement date_trunc logic.
    # Let's implement dynamic date range stats if requested.
    # User asked: "Statistics of each user and all users... (Day, Week, Month)"
    # I'll add logic to fetch last 30 days grouped by day.


@app.get("/api/v1/config", response_model=ConfigItem)
def get_config(db: Session = Depends(get_db), token: str = Depends(verify_token)):
    # Defaults
    defaults = {
        "api_url": os.getenv("DEFAULT_API_URL", "https://generativelanguage.googleapis.com"),
        "api_key": os.getenv("DEFAULT_API_KEY", ""),
        "model_name": os.getenv("DEFAULT_MODEL_NAME", "gemini-3-pro-image-preview"),
        "video_api_url": os.getenv("VIDEO_API_URL", ""),
        "video_api_key": os.getenv("VIDEO_API_KEY", ""),
        "video_model_name": os.getenv("VIDEO_MODEL_NAME", "sora-video-portrait"),
        "app_url": os.getenv("APP_URL", "http://localhost:33012"),
        "analysis_model_name": os.getenv("DEFAULT_ANALYSIS_MODEL_NAME", "gemini-3-pro-preview")
    }
    
    # Check if DB is empty for these keys, if so, seed them
    for key, val in defaults.items():
        item = db.query(SystemConfig).filter(SystemConfig.key == key).first()
        if not item:
            # Seed default
            new_item = SystemConfig(key=key, value=val)
            db.add(new_item)
            db.commit()
            db.refresh(new_item)
        else:
            defaults[key] = item.value
            
    return ConfigItem(**defaults)

@app.post("/api/v1/config", response_model=ConfigItem)
def update_config(config: ConfigItem, db: Session = Depends(get_db), token: str = Depends(verify_token)):
    # Update DB
    for key, val in config.dict().items():
        if val is not None:
            item = db.query(SystemConfig).filter(SystemConfig.key == key).first()
            if item:
                item.value = val
            else:
                item = SystemConfig(key=key, value=val)
                db.add(item)
    
    db.commit()
    return config

# ... (lines 170-432 omitted) ...

# --- Helper: File to Base64 ---
async def file_to_base64(file: UploadFile) -> str:
    content = await file.read()
    return base64.b64encode(content).decode('utf-8')

# --- Analysis Models ---
class ScriptItem(BaseModel):
    angle_name: str
    script: str

class AnalyzeResponse(BaseModel):
    product_description: str
    environment_analysis: str
    placement_mode: str
    scripts: List[ScriptItem]

# --- Helper: Image Generation ---
async def call_openai_compatible_api(
    client: httpx.AsyncClient, 
    api_url: str, 
    api_key: str, 
    product_b64: str, 
    bg_b64: str, 
    angle_name: str, 
    angle_prompt: str,
    model: str = "gemini-3-pro-image-preview" 
) -> ImageResult:
    print(f"DEBUG: Entering call_openai_compatible_api for {angle_name}. Model: {model}", flush=True)
    
    system_instruction = (
        "You are a professional product photographer. "
        "Your task is to generate a high-quality product image based on the input product image "
        "and blend it seamlessly into the style of the reference background image. "
        "Maintain the product's identity strictly. "
        "Return ONLY the generated image or a description of it."
    )
    
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": system_instruction
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text", 
                        "text": f"Task: {angle_prompt}. Style Reference: Use the lighting and mood from the second image provided."
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{product_b64}"
                        }
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{bg_b64}"
                        }
                    }
                ]
            }
        ],
        "temperature": 0.4,
        "max_tokens": 4096
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    # Retry logic for 429 errors
    max_retries = 3
    base_delay = 2.0
    
    for attempt in range(max_retries + 1):
        try:
            target_url = api_url
            if not target_url.endswith("/chat/completions") and not target_url.endswith(":generateContent"):
                 target_url = f"{target_url.rstrip('/')}/chat/completions"

            logger.info(f"Sending request for {angle_name} to {target_url} (Attempt {attempt+1}/{max_retries+1})")
            
            # Enable streaming
            payload["stream"] = True
            
            async with client.stream("POST", target_url, json=payload, headers=headers, timeout=600.0) as response:
                if response.status_code == 429:
                    if attempt < max_retries:
                        wait_time = base_delay * (2 ** attempt)
                        logger.warning(f"Rate limited (429). Retrying in {wait_time}s...")
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        error_text = await response.aread()
                        logger.error(f"API Error {response.status_code}: {error_text}")
                        return ImageResult(angle_name=angle_name, error=f"Rate Limit Exceeded (429): {error_text.decode('utf-8')}")

                if response.status_code != 200:
                    error_text = await response.aread()
                    logger.error(f"API Error {response.status_code}: {error_text}")
                    return ImageResult(angle_name=angle_name, error=f"API Error {response.status_code}: {error_text.decode('utf-8')}")

                full_content = ""
                async for line in response.aiter_lines():
                    if line.strip():
                        logger.info(f"Stream line: {line[:100]}")
                    if line.startswith("data: "):
                        data_str = line[6:]
                        if data_str.strip() == "[DONE]":
                            break
                        try:
                            import json
                            chunk = json.loads(data_str)
                            # Log the first chunk structure to debug
                            if not full_content:
                                logger.info(f"First chunk: {chunk}")
                            
                            choices = chunk.get("choices", [])
                            if choices and len(choices) > 0:
                                delta = choices[0].get("delta", {}).get("content", "")
                                if delta:
                                    full_content += delta
                            else:
                                # Some chunks might be usage info or empty
                                pass
                        except Exception as e:
                            logger.error(f"Chunk parse error: {e}")
                            pass
                
                content = full_content
                logger.info(f"API Response Content for {angle_name}: {content[:200]}...")
                
                # Check for HTML error response (e.g. Cloudflare 504/502)
                content_sample = content.strip().lower()
                if content_sample.startswith("html>") or content_sample.startswith("<!doctype") or "<html" in content_sample:
                    logger.error(f"Received HTML content instead of image for {angle_name}: {content[:200]}")
                    return ImageResult(angle_name=angle_name, error="API Gateway Timeout (Upstream Error)")

                import re
                # Try to find markdown image
                img_match = re.search(r'!\[.*?\]\((.*?)\)', content)
                if img_match:
                    return ImageResult(angle_name=angle_name, image_base64=img_match.group(1))
                    
                # If no markdown image, return content as is (might be base64 or text description)
                return ImageResult(angle_name=angle_name, image_base64=content)
            
        except Exception as e:
            logger.error(f"Request failed: {e}")
            if attempt < max_retries:
                wait_time = base_delay * (2 ** attempt)
                logger.warning(f"Request failed with {e}. Retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)
                continue
            return ImageResult(angle_name=angle_name, error=str(e))

# --- Helper: Analysis Logic ---
async def analyze_product_scene(
    client: httpx.AsyncClient,
    api_url: str,
    api_key: str,
    product_b64: str,
    ref_b64: str,
    category: str,
    model: str = "gemini-3-pro-preview",
    custom_product_name: Optional[str] = None
) -> AnalyzeResponse:
    
    system_instruction = (
        "You are a professional commercial photographer and art director. "
        "Your task is to analyze a product image and a style reference image to plan a photoshoot."
    )
    
    product_identity_prompt = "1. Identify the product in the first image."
    if custom_product_name:
        product_identity_prompt = f"1. The user has identified this product as: '{custom_product_name}'. Verify this and describe its key visual features."

    prompt = (
        f"Category: {category}.\n"
        f"{product_identity_prompt}\n"
        "2. Analyze the geometry and environment of the second image (style reference). Is it a wall, a table, outdoor, abstract?\n"
        "3. Determine the best 'Placement Mode' (e.g., Wall-mounted, Tabletop, Floating, Floor-standing). "
        "   - Logic: If it's a CCTV camera and the background is a wall, use Wall-mounted. If it's a bottle, use Tabletop.\n"
        "4. Generate 9 distinct photography scripts (prompts) for generating this product in this style.\n"
        "   - The scripts should vary in angle (Front, Side, Top, Hero, Close-up, Lifestyle, etc.) and lighting/composition details derived from the reference style.\n"
        "   - The scripts must strictly follow the 'Placement Mode' logic.\n"
        "Return JSON format ONLY: "
        "{ \"product_description\": \"...\", \"environment_analysis\": \"...\", \"placement_mode\": \"...\", \"scripts\": [ {\"angle_name\": \"...\", \"script\": \"...\"}, ... ] }"
    )

    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": system_instruction
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{product_b64}"}
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{ref_b64}"}
                    }
                ]
            }
        ],
        "temperature": 0.4,
        "max_tokens": 4096,
        "response_format": {"type": "json_object"}
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    target_url = api_url
    if not target_url.endswith("/chat/completions") and not target_url.endswith(":generateContent"):
         target_url = f"{target_url.rstrip('/')}/chat/completions"
         
    response = await client.post(target_url, json=payload, headers=headers, timeout=300.0)
    
    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=f"Analysis API Error: {response.text}")
        
    data = response.json()
    content = data.get("choices", [])[0].get("message", {}).get("content", "")
    
    import json
    try:
        # Clean markdown code blocks if present
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[0].strip()
            
        parsed = json.loads(content)
        return AnalyzeResponse(**parsed)
    except Exception as e:
        logger.error(f"Failed to parse analysis JSON: {content}")
        raise HTTPException(status_code=500, detail=f"Failed to parse analysis result: {e}")

@app.post("/api/v1/analyze", response_model=AnalyzeResponse)
async def analyze_endpoint(
    product_img: UploadFile = File(...),
    ref_img: UploadFile = File(...),
    category: str = Form(...),
    custom_product_name: Optional[str] = Form(None),
    api_url: str = Form(None),
    gemini_api_key: str = Form(None),
    model_name: str = Form(None), 
    db: Session = Depends(get_db),
    token: str = Depends(verify_token)
):
    # Resolve Config
    if not api_url or not gemini_api_key:
        db_config = get_config(db)
        if not api_url: api_url = db_config.api_url
        if not gemini_api_key: gemini_api_key = db_config.api_key
        # Use provided model or default from config
        if not model_name: model_name = db_config.analysis_model_name or "gemini-3-pro-preview"

    if not api_url or not gemini_api_key:
        raise HTTPException(status_code=400, detail="Missing API Configuration")

    product_b64 = await file_to_base64(product_img)
    ref_b64 = await file_to_base64(ref_img)
    
    async with httpx.AsyncClient() as client:
        return await analyze_product_scene(
            client, api_url, gemini_api_key, product_b64, ref_b64, category, model_name, custom_product_name
        )

# --- Main Endpoint ---
@app.post("/api/v1/batch-generate", status_code=202)
async def batch_generate_workflow(
    product_img: UploadFile = File(...),
    ref_img: UploadFile = File(...),
    scripts: str = Form(...),
    api_url: str = Form(None),
    gemini_api_key: str = Form(None),
    model_name: str = Form(None),
    aspect_ratio: str = Form("1:1"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    # Log Usage
    try:
        # Scripts is JSON string list of objects.
        # Estimate count?
        import json
        scripts_list = json.loads(scripts)
        count = len(scripts_list)
        
        log = ImageGenerationLog(user_id=user.id, count=count)
        db.add(log)
        db.commit()
    except Exception as e:
        logger.error(f"Failed to log usage: {e}")

    print(f"DEBUG: Received batch-generate request. Scripts length: {len(scripts)}", flush=True)
    # Resolve Config
    db_config = None
    if not api_url or not gemini_api_key or not model_name:
        # Fetch from DB if not provided in form (e.g. from frontend state bugs)
        db_config_list = db.query(SystemConfig).all()
        config_dict = {item.key: item.value for item in db_config_list}
        if not api_url: api_url = config_dict.get("api_url")
        if not gemini_api_key: gemini_api_key = config_dict.get("api_key")
        if not model_name: model_name = config_dict.get("model_name")
    
    # Analysis Model
    db_config_list = db.query(SystemConfig).all()
    config_dict = {item.key: item.value for item in db_config_list}
    analysis_model_name = config_dict.get("analysis_model_name", "gemini-3-pro-preview")

    # 1. Read Images
    product_bytes = await product_img.read()
    ref_bytes = await ref_img.read()
    product_b64 = base64.b64encode(product_bytes).decode('utf-8')
    ref_b64 = base64.b64encode(ref_bytes).decode('utf-8')

    # 3. Determine Prompts
    prompts_map = ANGLES_PROMPTS
    if scripts:
        try:
            import json
            script_list = json.loads(scripts)
            # script_list should be [{'angle_name': '...', 'script': '...'}, ...]
            prompts_map = { item['angle_name']: item['script'] for item in script_list }
        except Exception as e:
            logger.error(f"Failed to parse scripts: {e}")
            pass
    print(f"DEBUG: Prompts Map size: {len(prompts_map)} Keys: {list(prompts_map.keys())}", flush=True)

    # 4. Concurrency
    sem = asyncio.Semaphore(3) 

    async def clean_prompt_for_video(client, api_url, api_key, original_prompt, model_name):
        system_instruction = (
            "You are an expert prompt engineer. Your task is to rewrite the given image generation prompt "
            "into a fluent, descriptive, natural language paragraph suitable for a text-to-video model (like Sora or Veo). "
            "Remove any 'Generate a...' commands or system/technical instructions. "
            "Focus on describing the visual subject, lighting, and composition as a continuous scene. "
            "Keep it under 60 words."
        )
        
        payload = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": f"Original Prompt: {original_prompt}"}
            ],
            "max_tokens": 100
        }
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
        
        logger.info(f"Cleaning prompt using model: {model_name}")

        try:
            target_url = api_url
            if not target_url.endswith("/chat/completions"):
                 target_url = f"{target_url.rstrip('/')}/chat/completions"
            
            resp = await client.post(target_url, json=payload, headers=headers, timeout=60.0)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("choices", [])[0].get("message", {}).get("content", "").strip()
            else:
                 logger.error(f"Prompt cleaning API error: {resp.text}")
        except Exception as e:
            logger.error(f"Prompt cleaning failed: {e}")
        return original_prompt # Fallback

    async def safe_call(name, prompt):
        print(f"DEBUG: Starting safe_call for {name}", flush=True)
        async with sem:
            async with httpx.AsyncClient() as client:
                # Add Aspect Ratio to prompt if needed
                final_prompt = prompt
                if aspect_ratio:
                     final_prompt = f"{prompt} --ar {aspect_ratio}"

                result = await call_openai_compatible_api(
                    client, api_url, gemini_api_key, product_b64, ref_b64, name, final_prompt, model_name
                )
                
                # Use original Step 2 Prompt directly (User Request)
                # cleaned_prompt = await clean_prompt_for_video(client, api_url, gemini_api_key, prompt, analysis_model_name)
                # logger.info(f"Video Prompt generated for {name}: {cleaned_prompt[:50]}...")
                
                result.video_prompt = prompt
                
                # Verify persistence
                logger.info(f"SafeCall Result for {name}: video_prompt len={len(prompt) if prompt else 0}")
                
                return result

    tasks = []
    for name, prompt in prompts_map.items():
        tasks.append(safe_call(name, prompt))
    
    results = await asyncio.gather(*tasks)
    
    # Debug results
    valid_results = []
    for r in results:
        r_dict = r.dict()
        # Explicitly ensure video_prompt is copied if missing (though .dict() should work)
        if r.video_prompt and not r_dict.get("video_prompt"):
             r_dict["video_prompt"] = r.video_prompt
        valid_results.append(r_dict)
        
    logger.info(f"Final Batch Results Sample: {valid_results[0].keys()} has_prompt={'video_prompt' in valid_results[0]}")
    
    return {
        "status": "completed",
        "total_generated": len(valid_results),
        "results": valid_results
    }

# --- Video Queue Models ---


# --- Pydantic Models for Queue ---
class QueueItemCreate(BaseModel):
    prompt: str

class QueueItemUpdate(BaseModel):
    status: Optional[str] = None
    result_url: Optional[str] = None
    error_msg: Optional[str] = None

class StoryShot(BaseModel):
    shot: int
    prompt: str
    duration: int
    description: str
    shotStory: str
    heroSubject: Optional[str] = None

class StoryAnalysisResponse(BaseModel):
    shots: List[StoryShot]

@app.post("/api/v1/story-analyze", response_model=StoryAnalysisResponse)
async def analyze_storyboard_endpoint(
    image: UploadFile = File(...),
    topic: str = Form("一个产品的故事"), # Default topic if missing
    api_url: str = Form(None),
    gemini_api_key: str = Form(None),
    model_name: str = Form(None),
    db: Session = Depends(get_db),
    token: str = Depends(verify_token)
):
    # Resolve Config (Same pattern as other endpoints)
    db_config = None
    if not api_url or not gemini_api_key or not model_name:
        db_config_list = db.query(SystemConfig).all()
        config_dict = {item.key: item.value for item in db_config_list}
        if not api_url: api_url = config_dict.get("api_url")
        if not gemini_api_key: gemini_api_key = config_dict.get("api_key")
        # Use analysis model for script generation if available, else default
        if not model_name: model_name = config_dict.get("analysis_model_name", "gemini-3-pro-preview")
    
    # Read Image
    image_bytes = await file_to_base64(image)
    
    # Construct System Prompt
    system_prompt = f"""Role: You are a film storyboard artist.
Context: You are creating prompts for video generation.

IMPORTANT SAFETY GUIDELINES:
- Avoid explicit sexual content, graphic violence, hate speech
- Prefer implication and atmosphere over explicit description
- Use fictional characters/objects

Goal: Create a continuous storyboard with EXACTLY 3 shots for the story: "{topic}".

Global visual style: Filmic realism, natural lighting, soft bokeh, 35mm lens, muted colors, subtle grain.

*** CRITICAL NARRATIVE REQUIREMENTS ***
1. **Continuous Story Arc**:
   - Begin (Shot 1): Set scene, introduce subject.
   - Middle (Shot 2): Action, movement, conflict.
   - End (Shot 3): Resolution.
2. **Visual Consistency**: 
   - Define a "Hero Subject" in Shot 1 based on the provided image.
3. **Seamless Flow**: 
   - Each prompt must pick up IMMEDIATELY where the previous left off.
4. **Causal Relationship**: 
   - Explain WHY transition happens.
5. **Temporal Continuity**:
   - Strict chronological order.

Output format: ONLY a raw JSON array (no markdown code fences).

Required fields per shot:
- shot: integer (1..3)
- prompt: detailed safe image generation prompt (English).
- duration: integer (4, 6, or 8).
- description: Concise Chinese action summary.
- shotStory: Narrative description in Chinese (2-3 sentences) showing connection to previous shot.
- heroSubject: (ONLY in shot 1) Detailed visual description of the subject in the provided image.
"""

    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user", 
                "content": [
                    {"type": "text", "text": f"Generate storyboard for: {topic}"},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_bytes}"}}
                ]
            }
        ],
        "max_tokens": 2000
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {gemini_api_key}"
    }
    
    logger.info(f"Analyzing storyboard for topic: {topic}")
    
    async with httpx.AsyncClient() as client:
        try:
            target_url = api_url
            if not target_url.endswith("/chat/completions"):
                 target_url = f"{target_url.rstrip('/')}/chat/completions"
            
            resp = await client.post(target_url, json=payload, headers=headers, timeout=60.0)
            if resp.status_code == 200:
                data = resp.json()
                content = data.get("choices", [])[0].get("message", {}).get("content", "").strip()
                
                # Clean markdown if present
                if content.startswith("```json"):
                    content = content[7:]
                if content.startswith("```"):
                     content = content[3:]
                if content.endswith("```"):
                     content = content[:-3]
                
                try:
                    shots_data = json.loads(content)
                    return StoryAnalysisResponse(shots=[StoryShot(**s) for s in shots_data])
                except Exception as e:
                     logger.error(f"Failed to parse JSON: {content} - Error: {e}")
                     raise HTTPException(status_code=500, detail="Failed to parse storyboard JSON")
            else:
                 logger.error(f"Analysis API Error: {resp.text}")
                 raise HTTPException(status_code=resp.status_code, detail=f"API Error: {resp.text}")
        except Exception as e:
            logger.error(f"Storyboard Analysis Failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))

class VideoPromptResponse(BaseModel):
    video_prompt: str

@app.post("/api/v1/generate-video-prompt", response_model=VideoPromptResponse)
async def generate_video_prompt_endpoint(
    image: UploadFile = File(...),
    api_url: str = Form(None),
    gemini_api_key: str = Form(None),
    model_name: str = Form(None),
    db: Session = Depends(get_db),
    token: str = Depends(verify_token)
):
    # Resolve Config
    db_config = None
    if not api_url or not gemini_api_key or not model_name:
        db_config = get_config(db)

    if not api_url: api_url = db_config.api_url
    if not gemini_api_key: gemini_api_key = db_config.api_key
    
    # Use analysis model for prompt generation
    if not model_name: 
        model_name = db_config.analysis_model_name or "gemini-3-pro-preview"
        
    logger.info(f"Generating video prompt using model: {model_name} (from request: {model_name != (db_config.analysis_model_name or 'gemini-3-pro-preview')})")

    if not api_url or not gemini_api_key:
        raise HTTPException(status_code=400, detail="Missing API Configuration")

    image_b64 = await file_to_base64(image)

    system_instruction = (
        "You are an AI video director. Analyze this product image and generate a concise, high-quality text-to-video prompt "
        "(max 40 words) describing a cinematic camera movement (e.g., slow orbit, pan, zoom in) that best suits this specific angle and composition. "
        "Output ONLY the prompt in English."
    )
    
    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_instruction},
            {
                "role": "user", 
                "content": [
                    {"type": "text", "text": "Generate video prompt."},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}}
                ]
            }
        ],
        "max_tokens": 100
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {gemini_api_key}"
    }
    
    async with httpx.AsyncClient() as client:
        try:
            target_url = api_url
            if not target_url.endswith("/chat/completions"):
                 target_url = f"{target_url.rstrip('/')}/chat/completions"
            
            resp = await client.post(target_url, json=payload, headers=headers, timeout=60.0)
            if resp.status_code == 200:
                data = resp.json()
                prompt = data.get("choices", [])[0].get("message", {}).get("content", "").strip()
                return VideoPromptResponse(video_prompt=prompt)
            else:
                raise HTTPException(status_code=resp.status_code, detail=f"API Error: {resp.text}")
        except Exception as e:
            logger.error(f"Video prompt gen failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    status: Optional[str] = None
    result_url: Optional[str] = None
    error_msg: Optional[str] = None


@app.post("/api/v1/story-generate")
async def generate_story_endpoint(
    image: UploadFile = File(...),
    shots_json: str = Form(...),
    api_url: str = Form(None),
    gemini_api_key: str = Form(None),
    model_name: str = Form(None),
    db: Session = Depends(get_db),
    token: str = Depends(verify_token)
):
    # Config
    db_config_list = db.query(SystemConfig).all()
    config_dict = {item.key: item.value for item in db_config_list}
    if not api_url: api_url = config_dict.get("api_url")
    if not gemini_api_key: gemini_api_key = config_dict.get("api_key")
    if not model_name: model_name = config_dict.get("model_name")
    
    # Parse Scenes
    try:
        shots_data = json.loads(shots_json)
        shots = [StoryShot(**s) for s in shots_data]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")

    # Read Original Product
    original_bytes = await image.read()
    original_b64 = base64.b64encode(original_bytes).decode('utf-8')
    
    generated_results = []
    
    current_ref_b64 = original_b64 
    
    # Extract Hero Subject from Shot 1 to prepend to all
    hero_description = ""
    for s in shots:
        if s.shot == 1 and s.heroSubject:
            hero_description = s.heroSubject
            break
            
    async with httpx.AsyncClient() as client:
        for shot in shots:
            logger.info(f"Generating Shot {shot.shot}...")
            
            final_prompt = shot.prompt
            
            # Prepare Prompt with Injection
            system_instruction = (
                "Role: Cinematic frame artist. \n"
                "Goal: Render a single storyboard frame matching the style. \n"
                f"CRITICAL: Main Character: {hero_description} \n"
                "Style: Filmic realism, natural lighting, soft bokeh, 35mm lens. \n"
            )
            
            if shot.shot > 1:
                system_instruction += "Continuity: Maintain exact style continuity with previous shot. \n"
                final_prompt = (
                     f"Reference image above shows result of previous shot. "
                     f"Generate new frame where SAME character performs: {shot.prompt}"
                )
            else:
                 system_instruction += "Continuity: Establish base look. \n"
            
            full_prompt = (
                f"{system_instruction}\n"
                f"Frame Description: {final_prompt}\n"
                "Constraints: no text, 16:9, high fidelity."
            )
            
            try:
                # We use 'product_b64' slot for the main input image
                result = await call_openai_compatible_api(
                    client, api_url, gemini_api_key, 
                    current_ref_b64, # Input Image (Product for Shot 1, Prev result for Shot 2+)
                    original_b64,    # Ref Image (Always Original Product)
                    f"Shot {shot.shot}", 
                    full_prompt, 
                    model_name
                )
                
                if result.image_base64:
                    # Success
                    generated_results.append({
                        "shot": shot.shot,
                        "image_base64": result.image_base64,
                        "prompt": result.video_prompt or shot.prompt,
                        "description": shot.description,
                        "shotStory": shot.shotStory
                    })
                    # Update ref for next shot
                    current_ref_b64 = result.image_base64
                else:
                    logger.error(f"Shot {shot.shot} generation failed: No image returned.")
                    generated_results.append({"shot": shot.shot, "error": "Generation Failed"})
                    
            except Exception as e:
                logger.error(f"Shot {shot.shot} error: {e}")
                generated_results.append({"shot": shot.shot, "error": str(e)})

    return {
        "status": "completed",
        "results": generated_results
    }

class QueueItemResponse(BaseModel):
    id: str
    filename: str
    prompt: str
    status: str
    result_url: Optional[str] = None
    error_msg: Optional[str] = None
    created_at: datetime
    preview_url: Optional[str] = None
    
    class Config:
        orm_mode = True

# --- Queue APIs ---

@app.get("/api/v1/queue", response_model=List[QueueItemResponse])
def get_queue(db: Session = Depends(get_db), token: str = Depends(verify_token)):
    return db.query(VideoQueueItem).order_by(VideoQueueItem.created_at.asc()).all()

@app.post("/api/v1/queue")
async def add_to_queue(
    file: UploadFile = File(None),
    image_url: str = Form(None),
    prompt: str = Form(...),
    db: Session = Depends(get_db),
    token: str = Depends(verify_token), # Keep for backward compatibility if needed, or remove. 
    # Actually, we defined verify_token to return token string. 
    # But we want user object.
    # Let's replace 'token: str = ...' with 'user: User = Depends(get_current_user)'
    # Note: Frontend sends 'Authorization: Bearer <token>'
    user: User = Depends(get_current_user)
):
    if not file and not image_url:
        raise HTTPException(status_code=400, detail="Either file or image_url must be provided")

    # Save file
    upload_dir = "/app/uploads/queue"
    os.makedirs(upload_dir, exist_ok=True)
    
    file_id = ""
    file_path = ""
    filename = ""

    if file:
        filename = file.filename
        file_id = f"{int(datetime.now().timestamp())}_{filename}"
        file_path = os.path.join(upload_dir, file_id)
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)
    elif image_url:
        filename = "downloaded_image.png" # Default name or extract from URL?
        if "/" in image_url:
             filename = image_url.split("/")[-1].split("?")[0] # Simple extraction
             if not filename: filename = "image.png"
        
        file_id = f"{int(datetime.now().timestamp())}_{filename}"
        file_path = os.path.join(upload_dir, file_id)
        
        # Download image server-side (Proxy)
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(image_url, timeout=30.0)
                resp.raise_for_status()
                with open(file_path, "wb") as f:
                    f.write(resp.content)
        except Exception as e:
            logger.error(f"Failed to download image proxy: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to fetch image URL: {str(e)}")

    # Create DB record
    item = VideoQueueItem(
        id=str(int(datetime.now().timestamp() * 1000)), # Simple ID
        filename=filename,
        file_path=file_path,
        prompt=prompt,
        status="pending",
        user_id=user.id
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item

@app.put("/api/v1/queue/{item_id}")
def update_queue_item(
    item_id: str,
    update: QueueItemUpdate,
    db: Session = Depends(get_db),
    token: str = Depends(verify_token)
):
    item = db.query(VideoQueueItem).filter(VideoQueueItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    if update.status:
        item.status = update.status
    if update.result_url:
        item.result_url = update.result_url
    if update.error_msg:
        item.error_msg = update.error_msg
        
    db.commit()
    db.refresh(item)
    db.commit()
    db.refresh(item)
    return item

# --- Video Merge ---
class MergeRequest(BaseModel):
    video_ids: List[str]

@app.post("/api/v1/merge-videos")
async def merge_videos_endpoint(
    req: MergeRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    # 1. Validate and fetch videos
    videos = []
    for vid in req.video_ids:
        item = db.query(VideoQueueItem).filter(VideoQueueItem.id == vid).first()
        if not item:
            logger.warning(f"Video {vid} not found during merge")
            continue
        # Only allow successfully generated videos using their *result* path
        # Assuming result_url is http://.../uploads/queue/xxx.mp4
        # We need the local file path.
        if item.status != "done" or not item.result_url:
             logger.warning(f"Video {vid} not ready or missing result")
             continue
        videos.append(item)
    
    if not videos:
        raise HTTPException(status_code=400, detail="No valid videos selected for merging")

    # 2. Resolve local paths
    # Result URL: http://base/uploads/queue/video_123.mp4
    # File Path: /app/uploads/queue/video_123.mp4
    # We can infer filename from result_url
    local_paths = []
    for v in videos:
        # result_url likely ends with filename
        filename = v.result_url.split('/')[-1]
        local_path = os.path.join(QUEUE_DIR, filename)
        if os.path.exists(local_path):
            local_paths.append(local_path)
        else:
            logger.error(f"File missing on disk: {local_path}")

    if len(local_paths) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 valid video files to merge")

    # 3. Create ffmpeg list file
    import tempfile
    timestamp = int(datetime.now().timestamp())
    concat_list_path = os.path.join(QUEUE_DIR, f"concat_list_{timestamp}.txt")
    output_filename = f"merged_{timestamp}.mp4"
    output_path = os.path.join(QUEUE_DIR, output_filename)

    try:
        with open(concat_list_path, 'w') as f:
            for path in local_paths:
                f.write(f"file '{path}'\n")
        
        # 4. Run ffmpeg
        # ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4
        cmd = [
            "ffmpeg", "-f", "concat", "-safe", "0", 
            "-i", concat_list_path, 
            "-c", "copy", "-y", 
            output_path
        ]
        
        logger.info(f"Running merge command: {' '.join(cmd)}")
        process = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()
        
        if process.returncode != 0:
            logger.error(f"FFmpeg merge failed: {stderr.decode()}")
            raise Exception("FFmpeg merge process failed")

        # 5. Create new Queue Item for the merged video
        new_item = VideoQueueItem(
            id=str(int(datetime.now().timestamp() * 1000)),
            filename=output_filename,
            file_path=output_path,
            prompt="Merged Video: " + ", ".join([v.filename for v in videos]),
            status="done", # Immediately done
            result_url=f"/uploads/queue/{output_filename}",
            user_id=user.id
        )
        db.add(new_item)
        db.commit()
        db.refresh(new_item)
        
        # Cleanup list file
        if os.path.exists(concat_list_path):
            os.remove(concat_list_path)
            
        return new_item

    except Exception as e:
        logger.error(f"Merge error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/v1/queue/{item_id}")
def delete_queue_item(
    item_id: str,
    db: Session = Depends(get_db),
    token: str = Depends(verify_token)
):
    item = db.query(VideoQueueItem).filter(VideoQueueItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    # Delete file
    if item.file_path and os.path.exists(item.file_path):
        try:
            os.remove(item.file_path)
        except Exception as e:
            logger.error(f"Failed to delete file {item.file_path}: {e}")
            
    db.delete(item)
    db.commit()
    return {"status": "deleted"}

@app.delete("/api/v1/queue")
def clear_queue(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    token: str = Depends(verify_token)
):
    query = db.query(VideoQueueItem)
    if status:
        query = query.filter(VideoQueueItem.status == status)
    
    items = query.all()
    for item in items:
        if item.file_path and os.path.exists(item.file_path):
            try:
                os.remove(item.file_path)
            except Exception:
                pass
        db.delete(item)
    
    db.commit()
    db.commit()
    return {"status": "cleared", "count": len(items)}

# --- Background Task for Video Generation ---
async def process_video_background(item_id: str, video_api_url: str, video_api_key: str, video_model_name: str):
    logger.info(f"Background Task: Starting Video Generation for {item_id}")
    
    # Create a fresh DB session for the background task
    db = SessionLocal()
    try:
        item = db.query(VideoQueueItem).filter(VideoQueueItem.id == item_id).first()
        if not item:
            logger.error(f"Background Task: Item {item_id} not found")
            return

        # Read file and encode
        if not os.path.exists(item.file_path):
             item.status = "error"
             item.error_msg = "Source file not found"
             db.commit()
             return
             
        with open(item.file_path, "rb") as f:
            file_bytes = f.read()
            b64_img = base64.b64encode(file_bytes).decode('utf-8')

        target_url = video_api_url
        if not target_url.endswith("/chat/completions"):
             target_url = f"{target_url.rstrip('/')}/chat/completions"

        payload = {
             "model": video_model_name,
             "messages": [
                 {"role": "user", "content": [
                     {"type": "text", "text": f"Generate a video based on this image: {item.prompt}"},
                     {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64_img}"}}
                 ]}
             ],
             "stream": True 
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {video_api_key}"
        }

        logger.info(f"Posting to {target_url} (Stream Mode)")

        async with httpx.AsyncClient() as client:
            try:
                # 600s timeout for the generation process
                async with client.stream("POST", target_url, json=payload, headers=headers, timeout=600.0) as resp:
                    if resp.status_code != 200:
                        error_text = await resp.aread()
                        logger.error(f"Video API Error {resp.status_code}: {error_text}")
                        item.error_msg = f"API Error {resp.status_code}: {error_text.decode('utf-8')[:200]}"
                        item.status = "error"
                    else:
                        # Process Stream
                        full_content = ""
                        async for line in resp.aiter_lines():
                            if line.startswith("data: "):
                                if "[DONE]" in line: break
                                try:
                                    chunk = json.loads(line[6:])
                                    delta = chunk.get("choices", [])[0].get("delta", {})
                                    content_chunk = delta.get("content", "") or delta.get("reasoning_content", "")
                                    if content_chunk:
                                        full_content += content_chunk
                                except:
                                    pass
                        
                        # Parse final result
                        import re
                        # 1. Markdown Image
                        img_match = re.search(r'!\[.*?\]\((.*?)\)', full_content)
                        # 2. Raw URL (http...) - Updated to exclude trailing ' and )
                        url_match = re.search(r'https?://[^\s<>"\')]+|data:image/[^\s<>"\')]+', full_content)
                        
                        found_url = None
                        if img_match:
                            found_url = img_match.group(1)
                        elif url_match:
                            found_url = url_match.group(0)
                        
                        if found_url:
                            # Cleanup trailing punctuation just in case
                            found_url = found_url.strip("'\".,)>")
                            # Paranoid cleanup for trailing quotes
                            found_url = found_url.split("'")[0]
                            found_url = found_url.split('"')[0]
                            
                            # HTTP COMPATIBILITY: Do not force HTTPS as some file servers don't support it
                            # if found_url.startswith("http://"):
                            #    found_url = found_url.replace("http://", "https://", 1)
                            
                            item.result_url = found_url
                            item.status = "done"
                            logger.info(f"Video Generated Successfully: {found_url}")
                        else:
                             logger.warning(f"No URL found in video response: {full_content[:200]}")
                             item.error_msg = "No video URL found in response."
                             item.status = "error"
                             
            except httpx.TimeoutException:
                logger.error("Video Generation Timeout (600s)")
                item.error_msg = "Video Generation Timed Out"
                item.status = "error"
            except Exception as e:
                logger.error(f"Video Client Error: {e}")
                item.error_msg = f"Client Error: {str(e)}"
                item.status = "error"

        db.commit()
    except Exception as e:
        logger.error(f"Background Task Critical Error: {e}")
        db.rollback()
    finally:
        db.close()


@app.post("/api/v1/queue/{item_id}/generate")
async def generate_queue_item_endpoint(
    item_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    token: str = Depends(verify_token)
):
    # 1. Get queue item
    item = db.query(VideoQueueItem).filter(VideoQueueItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    # 2. Get Config
    db_config_list = db.query(SystemConfig).all()
    config_dict = {item.key: item.value for item in db_config_list}
    
    video_api_url = config_dict.get("video_api_url")
    video_api_key = config_dict.get("video_api_key")
    video_model_name = config_dict.get("video_model_name", "sora-video-portrait")

    if not video_api_url or not video_api_key:
         item.status = "error"
         item.error_msg = "Missing Video API Config"
         db.commit()
         raise HTTPException(status_code=400, detail="Missing Video API Config")

    # 3. Start Processing (Set status and trigger background task)
    item.status = "processing"
    db.commit()

    logger.info(f"Triggering Background Generation for {item_id}")
    background_tasks.add_task(process_video_background, item_id, video_api_url, video_api_key, video_model_name)

    return {"status": "processing", "message": "Video generation started in background"}


# --- Background Cleanup Task ---
CLEANUP_HOURS = int(os.getenv("CLEANUP_HOURS", "24"))

async def cleanup_task():
    while True:
        try:
            logger.info("Running cleanup task...")
            db = SessionLocal()
            cutoff = datetime.now() - timedelta(hours=CLEANUP_HOURS)
            
            # Find old items
            old_items = db.query(VideoQueueItem).filter(VideoQueueItem.created_at < cutoff).all()
            
            for item in old_items:
                logger.info(f"Cleaning up old item: {item.id}")
                if item.file_path and os.path.exists(item.file_path):
                    try:
                        os.remove(item.file_path)
                    except Exception as e:
                        logger.error(f"Failed to delete file {item.file_path}: {e}")
                db.delete(item)
            
            db.commit()
            db.close()
        except Exception as e:
            logger.error(f"Cleanup task failed: {e}")
            
        # Wait for 1 hour
        await asyncio.sleep(3600)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(cleanup_task())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
