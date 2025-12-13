import base64
import asyncio
import httpx
import os
import json
import logging
import subprocess
import uuid
# Fix for Starlette/python-multipart strict limits
try:
    # Patch python-multipart (if applicable)
    import multipart
    # Try multiple paths for safety
    try:
        multipart.multipart.MAX_MEMORY_FILE_SIZE = 100 * 1024 * 1024
        multipart.multipart.MAX_FILE_SIZE = 100 * 1024 * 1024
    except:
        pass

    # Patch Starlette (Critical for "Part exceeded" error)
    from starlette.formparsers import MultiPartParser
    MultiPartParser.max_file_size = 100 * 1024 * 1024 # 100MB
    MultiPartParser.max_part_size = 100 * 1024 * 1024 # 100MB
except ImportError:
    pass

import logging
from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, Depends, status, BackgroundTasks, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from sqlalchemy import create_engine, Column, String, Integer, DateTime, JSON, Text, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from datetime import datetime, timedelta, timezone

# Timezone: UTC+8 for China
CHINA_TZ = timezone(timedelta(hours=8))

def get_china_now():
    """Get current time in China timezone (UTC+8)."""
    return datetime.now(CHINA_TZ).replace(tzinfo=None)  # Remove tzinfo for DB compatibility

# Import WebSocket and Queue managers
from websocket_manager import connection_manager, init_websocket_manager, shutdown_websocket_manager
from queue_manager import get_task_queue, get_concurrency_limiter

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from fastapi.staticfiles import StaticFiles
from starlette.staticfiles import StaticFiles as StarletteStaticFiles
from starlette.responses import Response
from PIL import Image
import io

# Custom StaticFiles with 7-day cache for videos and images
class CachedStaticFiles(StarletteStaticFiles):
    """StaticFiles with Cache-Control header for media files."""
    
    async def get_response(self, path: str, scope) -> Response:
        response = await super().get_response(path, scope)
        # Set 7-day cache for media files
        if path.endswith(('.mp4', '.webm', '.mov', '.avi', '.jpg', '.jpeg', '.png', '.gif', '.webp')):
            response.headers["Cache-Control"] = "public, max-age=604800"  # 7 days
        return response

app = FastAPI(title="Product Scene Generator API")

# Mount uploads directory with 7-day cache
os.makedirs("/app/uploads", exist_ok=True)
app.mount("/uploads", CachedStaticFiles(directory="/app/uploads"), name="uploads")

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Database Setup ---
# Read from environment variable (set in .env or docker-compose)
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/db")

# Increase connection pool size to handle concurrent requests
engine = create_engine(
    DATABASE_URL,
    pool_size=20,           # Increased from default 5
    max_overflow=30,        # Increased from default 10
    pool_timeout=60,        # Increased timeout
    pool_recycle=1800,      # Recycle connections after 30 minutes
    pool_pre_ping=True      # Test connection health before use
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

from passlib.context import CryptContext
from jose import JWTError, jwt

# --- Auth Config ---
# JWT secret key - MUST be set in .env for production
SECRET_KEY = os.getenv("SECRET_KEY", "change-this-secret-key-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 1 day

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# --- Data Models ---
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)  # Login name (cannot change)
    nickname = Column(String, nullable=True)  # Display name (can change)
    avatar = Column(String, nullable=True)  # Avatar URL path
    default_share = Column(Boolean, default=False)  # Default share status for new content
    hashed_password = Column(String)
    role = Column(String, default="user") # 'admin', 'user'
    created_at = Column(DateTime, default=get_china_now)

class ImageGenerationLog(Base):
    __tablename__ = "image_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer)
    count = Column(Integer, default=1)
    created_at = Column(DateTime, default=get_china_now)

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
    category = Column(String, nullable=True, default="other")  # Product category
    is_merged = Column(Boolean, nullable=True, default=False)  # Flag for merged/composite videos
    is_shared = Column(Boolean, nullable=False, default=False)  # 是否分享给普通用户预览
    created_at = Column(DateTime, default=get_china_now)  # Use China timezone
    _preview_url = Column("preview_url", String, nullable=True)  # Custom preview URL

    @property
    def preview_url(self):
        # Return custom preview_url if set, otherwise derive from file_path
        if self._preview_url:
            return self._preview_url
        if self.file_path:
            # /app/uploads/queue/xxx -> /uploads/queue/xxx
            if self.file_path.startswith("/app/uploads"):
                return self.file_path.replace("/app/uploads", "/uploads")
        return None
    
    @preview_url.setter
    def preview_url(self, value):
        self._preview_url = value

# --- NEW: Gallery Model ---
class SavedImage(Base):
    __tablename__ = "saved_images"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    filename = Column(String)
    file_path = Column(String) # Local path /app/uploads/gallery/...
    url = Column(String) # Web URL /uploads/gallery/...
    prompt = Column(String)
    width = Column(Integer, nullable=True)  # Image width in pixels
    height = Column(Integer, nullable=True)  # Image height in pixels
    category = Column(String, nullable=True, default="other")  # Product category
    is_shared = Column(Boolean, nullable=False, default=False)  # 是否分享给普通用户预览
    created_at = Column(DateTime, default=get_china_now)

# Create tables
try:
    Base.metadata.create_all(bind=engine)
except Exception as e:
    logger.error(f"Database connection failed: {e}")

# ... (dependency omitted) ...
# ... (dependency omitted) ...
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
    site_title: Optional[str] = None
    site_subtitle: Optional[str] = None



# --- Background Task for Video Generation ---
async def process_video_background(item_id: str, video_api_url: str, video_api_key: str, video_model_name: str):
    logger.info(f"Background Task: Starting Video Generation for {item_id}")
    
    # Create a fresh DB session for the background task
    db = SessionLocal()
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

# --- User Activity Model ---
class UserActivity(Base):
    __tablename__ = "user_activities"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    action = Column(String)  # "image_gen_start", "video_gen_start", "login", etc.
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=get_china_now)

# Startup: Create Admin and Init Services
@app.on_event("startup")
async def startup_event():
    # Initialize database tables
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        logger.warning(f"Table creation warning: {e}")
    
    # Initialize WebSocket manager with Redis (will resolve hostname automatically)
    try:
        await init_websocket_manager()
        logger.info("WebSocket manager initialized")
    except Exception as e:
        logger.warning(f"WebSocket manager init failed (Redis may not be ready): {e}")
    
    # Create admin user
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

@app.on_event("shutdown")
async def shutdown_event():
    await shutdown_websocket_manager()
    logger.info("Shutdown complete")

# --- Public APIs (No Auth Required) ---

@app.get("/api/v1/public/videos")
def get_public_videos(
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """Get shared videos for public display (no auth required)."""
    query = db.query(VideoQueueItem).filter(
        VideoQueueItem.status.in_(["done", "archived"]),
        VideoQueueItem.is_shared == True
    )
    
    total = query.count()
    videos = query.order_by(VideoQueueItem.created_at.desc()).limit(limit).offset(offset).all()
    
    result_items = []
    for vid in videos:
        creator = db.query(User).filter(User.id == vid.user_id).first()
        result_items.append({
            "id": vid.id,
            "prompt": vid.prompt,
            "result_url": vid.result_url,
            "preview_url": vid.preview_url,
            "username": (creator.nickname or creator.username) if creator else "Creator",
            "avatar": creator.avatar if creator else None,
            "category": vid.category or "other",
            "is_merged": vid.is_merged or False,
            "created_at": vid.created_at
        })
    
    return {"total": total, "items": result_items}

@app.get("/api/v1/public/config")
def get_public_config(db: Session = Depends(get_db)):
    """Get public site configuration (no auth required)."""
    site_title = db.query(SystemConfig).filter(SystemConfig.key == "site_title").first()
    site_subtitle = db.query(SystemConfig).filter(SystemConfig.key == "site_subtitle").first()
    return {
        "site_title": site_title.value if site_title else os.getenv("SITE_TITLE", "BNP Studio"),
        "site_subtitle": site_subtitle.value if site_subtitle else os.getenv("SITE_SUBTITLE", "AI Video Gallery")
    }

# Login Endpoint
class Token(BaseModel):
    access_token: str
    token_type: str
    username: str
    role: str
    user_id: int

# Cloudflare Turnstile Secret Key (from .env)
TURNSTILE_SECRET_KEY = os.getenv("TURNSTILE_SECRET_KEY", "")

async def verify_turnstile(token: str, ip: str = None) -> bool:
    """Verify Cloudflare Turnstile token."""
    if not token:
        return False
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                data={
                    "secret": TURNSTILE_SECRET_KEY,
                    "response": token,
                    "remoteip": ip
                },
                timeout=10.0
            )
            result = response.json()
            return result.get("success", False)
    except Exception as e:
        logger.error(f"Turnstile verification failed: {e}")
        return False

@app.post("/api/v1/login", response_model=Token)
async def login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    turnstile_token: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    # Verify Turnstile if token provided and secret key is configured
    if turnstile_token and TURNSTILE_SECRET_KEY:
        client_ip = request.client.host if request.client else None
        is_valid = await verify_turnstile(turnstile_token, client_ip)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="人机验证失败，请重试"
            )
    
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
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
        "role": user.role,
        "user_id": user.id
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

# --- User Profile APIs ---

class UserProfileResponse(BaseModel):
    id: int
    username: str
    nickname: Optional[str] = None
    avatar: Optional[str] = None
    role: str
    created_at: datetime

class UpdateProfileRequest(BaseModel):
    nickname: Optional[str] = None
    password: Optional[str] = None
    default_share: Optional[bool] = None

@app.get("/api/v1/user/profile")
def get_user_profile(user: User = Depends(get_current_user)):
    """Get current user's profile."""
    return {
        "id": user.id,
        "username": user.username,
        "nickname": user.nickname or user.username,
        "avatar": user.avatar,
        "role": user.role,
        "default_share": user.default_share or False,
        "created_at": user.created_at
    }

@app.put("/api/v1/user/profile")
def update_user_profile(
    request: UpdateProfileRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Update current user's profile (nickname, password, default_share)."""
    if request.nickname is not None:
        user.nickname = request.nickname
    if request.password is not None and request.password.strip():
        user.hashed_password = get_password_hash(request.password)
    if request.default_share is not None:
        user.default_share = request.default_share
    db.commit()
    return {"message": "Profile updated successfully", "nickname": user.nickname, "default_share": user.default_share}

@app.post("/api/v1/user/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Upload user avatar image."""
    # Validate file type
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Invalid file type. Only JPEG, PNG, GIF, WebP allowed.")
    
    # Create avatars directory if not exists
    avatar_dir = "/app/uploads/avatars"
    os.makedirs(avatar_dir, exist_ok=True)
    
    # Generate unique filename
    ext = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
    filename = f"avatar_{user.id}_{int(datetime.now().timestamp())}.{ext}"
    file_path = f"{avatar_dir}/{filename}"
    
    # Save file
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Update user avatar URL
    avatar_url = f"/uploads/avatars/{filename}"
    user.avatar = avatar_url
    db.commit()
    
    return {"message": "Avatar uploaded successfully", "avatar": avatar_url}

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
        from_attributes = True

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

@app.delete("/api/v1/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    """Delete a user (admin only). Cannot delete self."""
    if admin.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if db_user.role == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete admin users")
    
    # Delete user's data (optional: could keep data or cascade)
    db.delete(db_user)
    db.commit()
    return {"message": "User deleted successfully"}

from sqlalchemy import func

@app.get("/api/v1/stats")
def get_stats(db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    # 1. User Summary Stats (Total Counts)
    users = db.query(User).all()
    user_stats = []
    
    # Get today's start in China timezone (00:00), then convert to UTC for comparison
    # This handles both old UTC data and new China timezone data
    now = get_china_now()
    today_start_china = now.replace(hour=0, minute=0, second=0, microsecond=0)
    # Convert China time 00:00 to UTC (subtract 8 hours): yesterday 16:00 UTC
    today_start_utc = today_start_china - timedelta(hours=8)
    
    for u in users:
        # Count actual saved images in gallery (not just generation attempts) - Total
        img_count = db.query(SavedImage).filter(SavedImage.user_id == u.id).count()
        # Count only completed videos - Total
        vid_count = db.query(VideoQueueItem).filter(
            VideoQueueItem.user_id == u.id,
            VideoQueueItem.status.in_(["done", "archived"])
        ).count()
        
        # Today's counts - use UTC start time for comparison
        # This counts items where created_at >= yesterday 16:00 UTC (= today 00:00 Beijing)
        today_img = db.query(SavedImage).filter(
            SavedImage.user_id == u.id,
            SavedImage.created_at >= today_start_utc
        ).count()
        today_vid = db.query(VideoQueueItem).filter(
            VideoQueueItem.user_id == u.id,
            VideoQueueItem.status.in_(["done", "archived"]),
            VideoQueueItem.created_at >= today_start_utc
        ).count()
        
        user_stats.append({
            "id": u.id,
            "username": u.username,
            "role": u.role,
            "image_count": img_count,
            "video_count": vid_count,
            "today_images": today_img,
            "today_videos": today_vid
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
        "analysis_model_name": os.getenv("DEFAULT_ANALYSIS_MODEL_NAME", "gemini-3-pro-preview"),
        "site_title": os.getenv("SITE_TITLE", "Banana Product"),
        "site_subtitle": os.getenv("SITE_SUBTITLE", "")
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
    logger.info(f"Image Generation Prompt for {angle_name}: {angle_prompt[:200]}...")  # Log first 200 chars
    
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
    custom_product_name: Optional[str] = None,
    gen_count: int = 9  # User-selected number of scripts
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
        f"4. Generate exactly {gen_count} distinct photography scripts (prompts) for generating this product in this style.\n"
        "   - The scripts must vary significantly in lighting (Natural, Studio, Neon, Sunset, etc.), environment (Indoor, Outdoor, Abstract, Texture), and composition.\n"
        "   - Avoid repetitive backgrounds. Each script should feel like a distinct photoshoot.\n"
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
    gen_count: int = Form(9),  # User-selected number of scripts to generate
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
            client, api_url, gemini_api_key, product_b64, ref_b64, category, model_name, custom_product_name, gen_count
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
    category: str = Form("other"),  # Product category
    scene_style_prompt: str = Form(""),  # Visual style prompt for scene generation
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
        
        # Log activity for monitoring
        activity = UserActivity(
            user_id=user.id,
            action="image_gen_start",
            details=f"开始生成 {count} 张图片 | 类目: {category} | 比例: {aspect_ratio}"
        )
        db.add(activity)
        db.commit()
        
        # Update user's real-time status and broadcast to admins
        try:
            await connection_manager.update_user_activity(user.id, f"正在生成 {count} 张图片")
        except Exception:
            pass  # WebSocket not required
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
    
    # --- Persistence Logic for Gallery ---
    gallery_dir = "/app/uploads/gallery"
    os.makedirs(gallery_dir, exist_ok=True)
    
    saved_count = 0
    async with httpx.AsyncClient() as download_client:
        for idx, r in enumerate(results):
            logger.info(f"Gallery save check [{idx}]: has_base64={bool(r.image_base64)}, error={r.error}, base64_len={len(r.image_base64) if r.image_base64 else 0}")
            if r.image_base64 and not r.error:
                try:
                    img_data = None
                    b64_data = r.image_base64
                    
                    # Check if it's a URL (API sometimes returns image URL instead of base64)
                    if b64_data.startswith("http://") or b64_data.startswith("https://"):
                        logger.info(f"Downloading image from URL: {b64_data[:100]}...")
                        try:
                            resp = await download_client.get(b64_data, timeout=60.0)
                            if resp.status_code == 200:
                                img_data = resp.content
                                logger.info(f"Downloaded image: {len(img_data)} bytes")
                            else:
                                logger.error(f"Failed to download image: HTTP {resp.status_code}")
                                continue
                        except Exception as dl_err:
                            logger.error(f"Image download error: {dl_err}")
                            continue
                    else:
                        # Handle base64 data
                        if "," in b64_data:
                            b64_data = b64_data.split(",")[1]
                        
                        img_data = base64.b64decode(b64_data)
                    
                    if not img_data:
                        logger.error("No image data to save")
                        continue
                    
                    # Validate that we have valid image data (JPEG or PNG magic bytes)
                    if not (img_data[:2] == b'\xff\xd8' or img_data[:8] == b'\x89PNG\r\n\x1a\n'):
                        logger.error(f"Invalid image data (first bytes: {img_data[:10]})")
                        continue
                    
                    # Determine extension based on magic bytes
                    ext = ".jpg" if img_data[:2] == b'\xff\xd8' else ".png"
                    
                    # 2. Save to Disk
                    filename = f"gen_{user.id}_{uuid.uuid4().hex}{ext}"
                    file_path = os.path.join(gallery_dir, filename)
                    
                    with open(file_path, "wb") as f:
                        f.write(img_data)
                    
                    logger.info(f"Saved gallery image: {filename} ({len(img_data)} bytes)")
                    
                    # Get image dimensions
                    img_width, img_height = None, None
                    try:
                        from PIL import Image
                        from io import BytesIO
                        img_pil = Image.open(BytesIO(img_data))
                        img_width, img_height = img_pil.size
                    except Exception as dim_err:
                        logger.warning(f"Could not get image dimensions: {dim_err}")
                        
                    # 3. Save to DB with category and dimensions
                    # Note: r.video_prompt holds the prompt used for this image
                    new_image = SavedImage(
                        user_id=user.id,
                        filename=filename,
                        file_path=file_path,
                        url=f"/uploads/gallery/{filename}",
                        prompt=r.video_prompt or r.angle_name,  # Fallback
                        width=img_width,
                        height=img_height,
                        category=category  # Use category from request
                    )
                    db.add(new_image)
                    saved_count += 1
                except Exception as e:
                    logger.error(f"Failed to save gallery image: {e}")
    
    if saved_count > 0:
        db.commit()
    # -------------------------------------

    # Debug results
    valid_results = []
    for r in results:
        r_dict = r.dict()
        # Explicitly ensure video_prompt is copied if missing (though .dict() should work)
        if r.video_prompt and not r_dict.get("video_prompt"):
             r_dict["video_prompt"] = r.video_prompt
        valid_results.append(r_dict)
        
    logger.info(f"Final Batch Results Sample: {valid_results[0].keys()} has_prompt={'video_prompt' in valid_results[0]}")
    
    # Log completion activity and reset user status
    try:
        activity = UserActivity(
            user_id=user.id,
            action="image_gen_complete",
            details=f"图片生成完成 | 生成 {len(valid_results)} 张 | 类目: {category}"
        )
        db.add(activity)
        db.commit()
        
        # Reset user status to idle
        await connection_manager.update_user_activity(user.id, "空闲")
    except Exception as act_err:
        logger.warning(f"Failed to log image completion: {act_err}")
    
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
    shot_count: int = Form(5), # Default 5 shots
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
    
    # Construct System Prompt with VideoGenerationPromptGuide integration
    system_prompt = f"""Role: You are a specialized assistant combining the skills of:
- A film storyboard artist creating continuous visual narratives
- A prompt engineer crafting clear, structured video generation prompts  
- A creative director ensuring coherent storytelling and strong visuals
- A safety reviewer ensuring strict policy compliance

=== SAFETY CONSTRAINTS (HIGHEST PRIORITY) ===
Prohibited content - NEVER include:
- Explicit sexual content, sexual acts, or strong innuendo
- Graphic violence, gore, blood, open wounds, or detailed injuries
- Hate speech, harassment, or demeaning content toward protected groups
- Praise of extremist organizations, symbols, or slogans
- Instructions for dangerous or illegal activities (weapons, drugs, crimes)
- Real-world personal data (PII), names with identifying information
- Highly realistic depictions of specific real celebrities or public figures
- Minors in any sexual, violent, exploitative, or unsafe context

Safe substitutes:
- "Sexy/seductive" → "stylish and confident", "elegant attire", "charismatic presence"
- Violence → "tense atmosphere", "distant flashes suggesting conflict", focus on emotional stakes
- Real celebrities → "a famous [role] archetype" (e.g., "a charismatic tech CEO archetype")

=== VIDEO PROMPT STRUCTURE ===
Each prompt must implicitly contain:
1. Subject: Who/what is at center (person, object, environment, abstract)
   - Use roles/archetypes over specific individuals
   - Describe relevant visual traits (clothing, posture, age group)

2. Action: What happens - use strong verbs
   - "explaining", "demonstrating", "pointing", "walking", "assembling", "observing", "testing", "exploring"
   - Avoid explicit, violent, or unsafe actions

3. Scene/Context: Where/when/atmosphere
   - Location (indoor/outdoor/virtual)
   - Time of day (morning, sunset, night, golden hour)
   - Environmental details (weather, textures, background elements)

4. Camera: Angle and framing
   - Eye-level medium shot, wide establishing shot, close-up, bird's-eye view
   - Keep simple: 1-2 main angles per shot

5. Camera Movement (optional):
   - Stable shot for clarity, slow pan for scenery, gentle push-in for emphasis
   - Limit to one primary movement per short clip

6. DYNAMIC ELEMENTS (REQUIRED - not just camera movement!):
   - Each shot MUST include real motion in the scene, not just camera panning
   - Examples: particles floating, steam rising, reflections changing, hands interacting with product
   - Environmental motion: leaves, wind effects, light rays, shadows shifting
   - Avoid: static scenes where only the camera moves while everything else is frozen

7. Visual Style:
   - Lighting: natural/artificial, mood (soft, dramatic, moody)
   - Tone: "warm and welcoming", "calm and meditative", "modern and energetic"
   - Art style: "photorealistic cinematic", "2D animation", "hand-drawn illustration"
   - Atmosphere: haze, dust particles, rain reflections, light beams

=== STORYBOARD REQUIREMENTS ===
Goal: Create a continuous storyboard with EXACTLY {shot_count} shots for the story: "{topic}".

Global visual style: Filmic realism, natural lighting, soft bokeh, 35mm lens, muted colors, subtle grain.

*** CRITICAL NARRATIVE REQUIREMENTS ***
1. **Continuous Story Arc**:
   - Begin (Shot 1): Set scene, introduce subject.
   - Middle (Shot 2-{shot_count-1}): Action, movement, conflict.
   - End (Shot {shot_count}): Resolution.
2. **Visual Consistency**: 
   - Define a "Hero Subject" in Shot 1 based on the provided image.
3. **Seamless Flow**: 
   - Each prompt must pick up IMMEDIATELY where the previous left off.
4. **Causal Relationship**: 
   - Explain WHY transition happens.
5. **Temporal Continuity**:
   - Strict chronological order.

=== OUTPUT FORMAT ===
Output: ONLY a raw JSON array (no markdown code fences).

Required fields per shot:
- shot: integer (1..{shot_count})
- prompt: detailed safe video generation prompt (English), following the structure above
- duration: integer (always 15)
- description: Concise Chinese action summary
- shotStory: Narrative description in Chinese (2-3 sentences) showing connection to previous shot
- heroSubject: (Required in ALL shots) Detailed visual description of the main product/subject from the image - must be IDENTICAL across all shots for consistency

=== SELF-CHECK BEFORE OUTPUT ===
✔ No explicit sexual content or innuendo
✔ No graphic violence, gore, or injuries
✔ No hate speech or extremist content
✔ No real celebrities or PII
✔ No minors in unsafe scenarios
✔ Each prompt has: subject, action, scene, camera, style
✔ Story flows continuously between shots
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
        "max_tokens": 8192
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
                if content.startswith("```"):
                    lines = content.splitlines()
                    # Remove first line if it starts with ```
                    if lines[0].startswith("```"):
                        lines = lines[1:]
                    # Remove last line if it starts with ```
                    if lines and lines[-1].strip().startswith("```"):
                        lines = lines[:-1]
                    content = "\n".join(lines).strip()
                
                # Fix trailing commas which cause json.loads to fail
                import re
                content = re.sub(r',\s*\}', '}', content)
                content = re.sub(r',\s*\]', ']', content)
                
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
        from_attributes = True


# --- Gallery Endpoints ---

@app.get("/api/v1/gallery/images")
def get_gallery_images(
    limit: int = 50, 
    offset: int = 0,
    category: str = None,  # Filter by category
    view_mode: str = "own",  # "own" | "all" (admin only)
    db: Session = Depends(get_db), 
    user: User = Depends(get_current_user)
):
    """Get images based on user role and view mode.
    
    - Admin with view_mode='all': All images from all users
    - Admin with view_mode='own': Only admin's own images
    - Regular user: Own images + shared images (is_shared=True)
    """
    from sqlalchemy import or_
    
    if user.role == "admin":
        if view_mode == "own":
            query = db.query(SavedImage).filter(SavedImage.user_id == user.id)
        else:  # "all" - admin can see everything
            query = db.query(SavedImage)
    else:
        # Regular user: own images + shared images
        query = db.query(SavedImage).filter(
            or_(SavedImage.user_id == user.id, SavedImage.is_shared == True)
        )
    
    # Apply category filter if provided
    if category and category != "all":
        query = query.filter(SavedImage.category == category)
        
    total = query.count()
    images = query.order_by(SavedImage.created_at.desc()).limit(limit).offset(offset).all()
    
    # Add username and metadata to each image
    result_items = []
    for img in images:
        creator = db.query(User).filter(User.id == img.user_id).first()
        result_items.append({
            "id": img.id,
            "user_id": img.user_id,
            "username": creator.username if creator else "Unknown",
            "filename": img.filename,
            "file_path": img.file_path,
            "url": img.url,
            "prompt": img.prompt,
            "width": img.width,
            "height": img.height,
            "category": img.category or "other",
            "is_shared": img.is_shared,
            "created_at": img.created_at
        })
    
    return {"total": total, "items": result_items}

@app.delete("/api/v1/gallery/images/{image_id}")
def delete_gallery_image(
    image_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Delete a single image. Users can delete their own, admins can delete any."""
    if user.role == "admin":
        image = db.query(SavedImage).filter(SavedImage.id == image_id).first()
    else:
        image = db.query(SavedImage).filter(SavedImage.id == image_id, SavedImage.user_id == user.id).first()
    
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    # Delete file from disk
    if image.file_path and os.path.exists(image.file_path):
        try:
            os.remove(image.file_path)
        except Exception as e:
            logger.error(f"Failed to delete gallery image file: {e}")
            
    db.delete(image)
    db.commit()
    return {"status": "deleted"}

class BatchDeleteRequest(BaseModel):
    ids: List[int]

@app.post("/api/v1/gallery/images/batch-delete")
def batch_delete_images(
    request: BatchDeleteRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    """Batch delete images (admin only)."""
    deleted_count = 0
    for image_id in request.ids:
        image = db.query(SavedImage).filter(SavedImage.id == image_id).first()
        if image:
            if image.file_path and os.path.exists(image.file_path):
                try:
                    os.remove(image.file_path)
                except Exception as e:
                    logger.error(f"Failed to delete file: {e}")
            db.delete(image)
            deleted_count += 1
    db.commit()
    return {"deleted": deleted_count}

class BatchDeleteVideoRequest(BaseModel):
    ids: List[str]

@app.post("/api/v1/gallery/videos/batch-delete")
def batch_delete_videos(
    request: BatchDeleteVideoRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    """Batch delete videos (admin only)."""
    deleted_count = 0
    for video_id in request.ids:
        video = db.query(VideoQueueItem).filter(VideoQueueItem.id == video_id).first()
        if video:
            # Delete video file
            if video.result_url:
                video_path = video.result_url.replace("/uploads", "/app/uploads")
                if os.path.exists(video_path):
                    try:
                        os.remove(video_path)
                    except Exception as e:
                        logger.error(f"Failed to delete video file: {e}")
            # Delete source image
            if video.file_path and os.path.exists(video.file_path):
                try:
                    os.remove(video.file_path)
                except Exception as e:
                    logger.error(f"Failed to delete source file: {e}")
            db.delete(video)
            deleted_count += 1
    db.commit()
    return {"deleted": deleted_count}


@app.get("/api/v1/gallery/videos")
def get_gallery_videos(
    limit: int = 20,
    offset: int = 0,
    category: str = None,  # Filter by category
    view_mode: str = "own",  # "own" | "all" (admin only)
    db: Session = Depends(get_db), 
    user: User = Depends(get_current_user)
):
    """Get videos based on user role and view mode.
    
    - Admin with view_mode='all': All completed videos from all users
    - Admin with view_mode='own': Only admin's own completed videos
    - Regular user: Own videos + shared videos (is_shared=True)
    """
    from sqlalchemy import or_, and_
    
    # Base filter: only completed videos
    base_filter = VideoQueueItem.status.in_(["done", "archived"])
    
    if user.role == "admin":
        if view_mode == "own":
            query = db.query(VideoQueueItem).filter(
                and_(base_filter, VideoQueueItem.user_id == user.id)
            )
        else:  # "all" - admin can see everything
            query = db.query(VideoQueueItem).filter(base_filter)
    else:
        # Regular user: own videos + shared videos
        query = db.query(VideoQueueItem).filter(
            and_(
                base_filter,
                or_(VideoQueueItem.user_id == user.id, VideoQueueItem.is_shared == True)
            )
        )
    
    # Apply category filter if provided
    if category and category != "all":
        query = query.filter(VideoQueueItem.category == category)
    
    total = query.count()
    videos = query.order_by(VideoQueueItem.created_at.desc()).limit(limit).offset(offset).all()
    
    # Build response with username and preview_url
    result_items = []
    for vid in videos:
        creator = db.query(User).filter(User.id == vid.user_id).first()
        result_items.append({
            "id": vid.id,
            "filename": vid.filename,
            "file_path": vid.file_path,
            "prompt": vid.prompt,
            "status": vid.status,
            "result_url": vid.result_url,
            "error_msg": vid.error_msg,
            "user_id": vid.user_id,
            "username": creator.username if creator else "Unknown",
            "preview_url": vid.preview_url,
            "category": vid.category or "other",
            "is_merged": vid.is_merged or False,
            "is_shared": vid.is_shared,
            "created_at": vid.created_at
        })
    
    return {"total": total, "items": result_items}

# --- Share Toggle Endpoints ---

@app.post("/api/v1/gallery/images/{image_id}/share")
def toggle_share_image(
    image_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    """Toggle share status of an image (admin only).
    When is_shared=True, regular users can view this image.
    """
    image = db.query(SavedImage).filter(SavedImage.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    image.is_shared = not image.is_shared
    db.commit()
    return {"id": image_id, "is_shared": image.is_shared}

@app.post("/api/v1/gallery/videos/{video_id}/share")
def toggle_share_video(
    video_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    """Toggle share status of a video (admin only).
    When is_shared=True, regular users can view this video.
    """
    video = db.query(VideoQueueItem).filter(VideoQueueItem.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    video.is_shared = not video.is_shared
    db.commit()
    return {"id": video_id, "is_shared": video.is_shared}

class BatchShareRequest(BaseModel):
    ids: List[int]
    is_shared: bool  # True = share, False = unshare

class BatchShareVideoRequest(BaseModel):
    ids: List[str]
    is_shared: bool

@app.post("/api/v1/gallery/images/batch-share")
def batch_share_images(
    request: BatchShareRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    """Batch share/unshare images (admin only)."""
    updated_count = 0
    for image_id in request.ids:
        image = db.query(SavedImage).filter(SavedImage.id == image_id).first()
        if image:
            image.is_shared = request.is_shared
            updated_count += 1
    db.commit()
    return {"updated": updated_count, "is_shared": request.is_shared}

@app.post("/api/v1/gallery/videos/batch-share")
def batch_share_videos(
    request: BatchShareVideoRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    """Batch share/unshare videos (admin only)."""
    updated_count = 0
    for video_id in request.ids:
        video = db.query(VideoQueueItem).filter(VideoQueueItem.id == video_id).first()
        if video:
            video.is_shared = request.is_shared
            updated_count += 1
    db.commit()
    return {"updated": updated_count, "is_shared": request.is_shared}

class ShareAllRequest(BaseModel):
    is_shared: bool  # True = share all, False = unshare all
    skip_first_page: bool = False  # Optional: skip the first N items
    skip_count: int = 0  # Number of items to skip (e.g., first 9 items = 1 page)

@app.post("/api/v1/gallery/images/share-all")
def share_all_images(
    request: ShareAllRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    """Share/unshare all images (admin only)."""
    query = db.query(SavedImage).order_by(SavedImage.created_at.desc())
    if request.skip_count > 0:
        query = query.offset(request.skip_count)
    images = query.all()
    for image in images:
        image.is_shared = request.is_shared
    db.commit()
    return {"updated": len(images), "is_shared": request.is_shared}

@app.post("/api/v1/gallery/videos/share-all")
def share_all_videos(
    request: ShareAllRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    """Share/unshare all completed videos (admin only)."""
    query = db.query(VideoQueueItem).filter(
        VideoQueueItem.status.in_(["done", "archived"])
    ).order_by(VideoQueueItem.created_at.desc())
    if request.skip_count > 0:
        query = query.offset(request.skip_count)
    videos = query.all()
    for video in videos:
        video.is_shared = request.is_shared
    db.commit()
    return {"updated": len(videos), "is_shared": request.is_shared}

# --- Queue APIs ---

@app.get("/api/v1/queue", response_model=List[QueueItemResponse])
def get_queue(db: Session = Depends(get_db), token: str = Depends(verify_token)):
    # Exclude archived items from queue list (they're preserved for gallery only)
    return db.query(VideoQueueItem).filter(
        VideoQueueItem.status != "archived"
    ).order_by(VideoQueueItem.created_at.asc()).all()

@app.post("/api/v1/queue")
async def add_to_queue(
    file: UploadFile = File(None),
    image_url: str = Form(None),
    prompt: str = Form(...),
    category: str = Form("other"),  # Product category
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
        user_id=user.id,
        category=category  # Product category
    )
    db.add(item)
    
    # Log activity for monitoring
    activity = UserActivity(
        user_id=user.id,
        action="video_gen_start",
        details=f"开始生成视频 | 类目: {category} | 提示词: {prompt[:50]}..."
    )
    db.add(activity)
    
    db.commit()
    db.refresh(item)
    
    # Update user status to show video generation in progress
    try:
        await connection_manager.update_user_activity(user.id, "正在生成视频")
    except Exception:
        pass  # WebSocket not required
    
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

@app.post("/api/v1/queue/{item_id}/retry")
async def retry_queue_item(
    item_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    token: str = Depends(verify_token)
):
    """Retry a failed video generation task."""
    item = db.query(VideoQueueItem).filter(VideoQueueItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    if item.status != "error":
        raise HTTPException(status_code=400, detail="Only failed items can be retried")
    
    # Reset status and error message
    item.status = "pending"
    item.error_msg = None
    db.commit()
    
    # Get config and trigger background task
    db_config_list = db.query(SystemConfig).all()
    config_dict = {conf.key: conf.value for conf in db_config_list}
    
    video_api_url = config_dict.get("video_api_url")
    video_api_key = config_dict.get("video_api_key")
    video_model_name = config_dict.get("video_model_name", "sora-video-portrait")
    
    if not video_api_url or not video_api_key:
        raise HTTPException(status_code=400, detail="Video API not configured")
    
    # Trigger background generation
    background_tasks.add_task(process_video_background, item_id, video_api_url, video_api_key, video_model_name)
    
    return {"status": "retrying", "item_id": item_id}

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
    count = len(items)
    
    for item in items:
        if (item.status in ["done", "archived"]) and item.result_url:
            # Archive completed/archived videos instead of deleting (preserve for gallery)
            if item.status == "done":
                item.status = "archived"
            # Skip already archived items (no action needed)
        else:
            # Delete non-completed items (pending, error, processing, etc.) and their source files
            if item.file_path and os.path.exists(item.file_path):
                try:
                    os.remove(item.file_path)
                except Exception:
                    pass
            db.delete(item)
    
    db.commit()
    return {"status": "cleared", "count": count}

# --- Background Task for Video Generation ---

async def convert_sora_to_watermark_free(sora_url: str) -> str:
    """
    Placeholder for watermark removal - currently disabled.
    The dyysy.com service was removed as it returns HTML instead of video for sora.codeedu.de URLs.
    Watermark removal needs to be handled at the API provider level (74.48.17.33).
    """
    # Watermark removal disabled - return original URL
    return sora_url

async def process_video_background(item_id: str, video_api_url: str, video_api_key: str, video_model_name: str):
    logger.info(f"Background Task: Starting Video Generation for {item_id}")
    
    # Create a fresh DB session for the background task
    db = SessionLocal()
    try:
        item = db.query(VideoQueueItem).filter(VideoQueueItem.id == item_id).first()
        if not item:
            logger.error(f"Background Task: Item {item_id} not found")
            return

        # Update status to processing immediately
        item.status = "processing"
        db.commit()

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
        
        # Disable stream mode to avoid hanging connections
        payload["stream"] = False 

        logger.info(f"Posting to {target_url} (Non-Stream Mode)")

        async with httpx.AsyncClient() as client:
            try:
                # 900s (15 min) timeout for the generation process - increased for longer videos
                resp = await client.post(target_url, json=payload, headers=headers, timeout=900.0)
                
                if resp.status_code != 200:
                    logger.error(f"Video API Error {resp.status_code}: {resp.text}")
                    item.error_msg = f"API Error {resp.status_code}: {resp.text[:200]}"
                    item.status = "error"
                else:
                    data = resp.json()
                    # Standard OpenAI format: choices[0].message.content
                    full_content = data.get("choices", [])[0].get("message", {}).get("content", "")
                        
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
                        
                        # Try to convert Sora URL to watermark-free version
                        found_url = await convert_sora_to_watermark_free(found_url)
                        
                        # Download video to local storage if it's an external URL
                        final_url = found_url
                        preview_url = None
                        
                        if found_url.startswith("http"):
                            try:
                                local_filename = f"video_{item_id}.mp4"
                                local_path = f"/app/uploads/queue/{local_filename}"
                                
                                async with httpx.AsyncClient() as download_client:
                                    video_resp = await download_client.get(found_url, timeout=300.0)
                                    if video_resp.status_code == 200:
                                        with open(local_path, "wb") as f:
                                            f.write(video_resp.content)
                                        final_url = f"/uploads/queue/{local_filename}"
                                        logger.info(f"Video downloaded to local: {final_url}")
                                        
                                        # Generate thumbnail from first frame
                                        thumb_filename = f"video_{item_id}_thumb.jpg"
                                        thumb_path = f"/app/uploads/queue/{thumb_filename}"
                                        try:
                                            thumb_cmd = [
                                                "ffmpeg", "-y",
                                                "-i", local_path,
                                                "-ss", "00:00:00.500",
                                                "-vframes", "1",
                                                "-q:v", "2",
                                                thumb_path
                                            ]
                                            subprocess.run(thumb_cmd, check=True, capture_output=True)
                                            preview_url = f"/uploads/queue/{thumb_filename}"
                                        except Exception as thumb_err:
                                            logger.warning(f"Failed to generate thumbnail: {thumb_err}")
                                    else:
                                        logger.warning(f"Failed to download video: HTTP {video_resp.status_code}")
                            except Exception as dl_err:
                                logger.warning(f"Video download failed, keeping remote URL: {dl_err}")
                        
                        item.result_url = final_url
                        if preview_url:
                            item.preview_url = preview_url
                        item.status = "done"
                        logger.info(f"Video Generated Successfully: {final_url}")
                        
                        # Log activity and update user status
                        try:
                            activity = UserActivity(
                                user_id=item.user_id,
                                action="video_gen_complete",
                                details=f"视频生成完成 | 提示词: {item.prompt[:30]}..."
                            )
                            db.add(activity)
                            
                            # Update user status to idle and broadcast
                            await connection_manager.update_user_activity(item.user_id, "空闲")
                        except Exception as act_err:
                            logger.warning(f"Failed to log video completion: {act_err}")
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
    config_dict = {conf.key: conf.value for conf in db_config_list}
    
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
    
    # 4. Log activity for monitoring
    activity = UserActivity(
        user_id=item.user_id,
        action="video_gen_processing",
        details=f"视频生成中 | 提示词: {item.prompt[:50] if item.prompt else '无'}..."
    )
    db.add(activity)
    db.commit()
    
    # 5. Update user status via WebSocket
    try:
        await connection_manager.update_user_activity(item.user_id, "正在生成视频")
    except Exception:
        pass  # WebSocket not required

    logger.info(f"Triggering Background Generation for {item_id}")
    background_tasks.add_task(process_video_background, item_id, video_api_url, video_api_key, video_model_name)

    return {"status": "processing", "message": "Video generation started in background"}


# --- Background Cleanup Task ---
CLEANUP_HOURS = int(os.getenv("CLEANUP_HOURS", "168"))  # Default 7 days (168 hours)

async def cleanup_task():
    while True:
        try:
            logger.info("Running cleanup task...")
            db = SessionLocal()
            cutoff = datetime.now() - timedelta(hours=CLEANUP_HOURS)
            
            # Find old items, EXCLUDE completed/archived videos and merged story videos
            old_items = db.query(VideoQueueItem).filter(
                VideoQueueItem.created_at < cutoff,
                VideoQueueItem.status.notin_(["done", "archived"]),  # Keep completed videos
                ~VideoQueueItem.filename.like("story_chain%"),  # Keep merged chain videos
                ~VideoQueueItem.filename.like("story_fission%")  # Keep merged fission videos
            ).all()
            
            for item in old_items:
                logger.info(f"Cleaning up old item: {item.id} ({item.filename})")
                if item.file_path and os.path.exists(item.file_path):
                    try:
                        os.remove(item.file_path)
                    except Exception as e:
                        logger.error(f"Failed to delete file {item.file_path}: {e}")
                db.delete(item)
            
            db.commit()
            db.close()
            logger.info(f"Cleanup task completed. Removed {len(old_items)} old items.")
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

# --- Story Chain Implementation ---

class StoryChainRequest(BaseModel):
    initial_image_url: str # Base64 or URL
    shots: List[dict] # From analyze step
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    visual_style: Optional[str] = None  # Visual style ID
    visual_style_prompt: Optional[str] = None  # Visual style prompt text
    camera_movement: Optional[str] = None  # Camera movement ID
    camera_movement_prompt: Optional[str] = None  # Camera movement prompt text

STORY_CHAIN_STATUS = {}

def extract_last_frame(video_path: str) -> str:
    """Extracts last frame from video and saves as temp image. Returns path."""
    try:
        # Resolve path
        if video_path.startswith("/uploads"):
            video_path = f"/app{video_path}"
            
        if not os.path.exists(video_path):
            raise Exception(f"Video file not found: {video_path}")
        
        output_path = video_path.replace(".mp4", "_last.jpg")
        # Ensure we overwrite
        if os.path.exists(output_path):
            os.remove(output_path)
            
        # ffmpeg command to extract last frame
        # Use -0.5 instead of -0.1 to avoid seeking errors at very end of file
        cmd = [
            "ffmpeg", "-y", 
            "-sseof", "-0.5", 
            "-i", video_path, 
            "-update", "1", 
            "-q:v", "2", 
            output_path
        ]
        # Allow stderr to show in logs for debugging
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
        
        if not os.path.exists(output_path):
             raise Exception("Frame extraction failed: Output not created")
             
        return output_path
    except Exception as e:
        logging.error(f"Extract Frame Error: {e}")
        return None

async def process_story_chain(chain_id: str, req: StoryChainRequest, user_id: int):
    status = {"status": "processing", "current_shot": 0, "total_shots": len(req.shots), "video_ids": [], "error": None, "merged_video_url": None}
    STORY_CHAIN_STATUS[chain_id] = status
    
    # Config resolution
    db = SessionLocal()
    db_config_list = db.query(SystemConfig).all()
    config_dict = {item.key: item.value for item in db_config_list}
    db.close()
    
    final_api_url = req.api_url or config_dict.get("video_api_url", "")
    final_api_key = req.api_key or config_dict.get("video_api_key", "")
    final_model = req.model_name or config_dict.get("video_model_name", "sora-video-portrait")
    
    # Get image generation API config for pre-processing
    image_api_url = config_dict.get("api_url", "")
    image_api_key = config_dict.get("api_key", "")
    image_model = config_dict.get("image_model_portrait", "gemini-2.5-flash-preview-05-20")  # Portrait image model
    analysis_model = config_dict.get("analysis_model_name", "gemini-3-pro-preview")  # 尾帧分析模型
    
    # 存储从尾帧分析生成的下一镜头 prompt（用于替换原始脚本）
    next_shot_prompt_override = None

    try:
        current_image_source = req.initial_image_url
        
        # Ensure queue dir exists
        os.makedirs("/app/uploads/queue", exist_ok=True)
        
        # === STEP 0: Pre-process original image with image generation model ===
        # This "washes" the original image to create a stylized version before video generation
        logging.info(f"Chain {chain_id}: Preprocessing check - image_api_url={bool(image_api_url)}, image_api_key={bool(image_api_key)}, shots={len(req.shots)}, visual_style={req.visual_style_prompt[:50] if req.visual_style_prompt else 'None'}...")
        
        if image_api_url and image_api_key and len(req.shots) > 0:
            logging.info(f"Chain {chain_id}: Pre-processing original image with {image_model}")
            status["current_shot"] = 0
            status["status"] = "preprocessing"
            
            try:
                # Get the first shot's prompt and heroSubject for context
                first_shot = req.shots[0]
                hero_subject = first_shot.get("heroSubject", "")
                first_prompt = first_shot.get("prompt", "")
                
                # Prepare the original image as base64
                if current_image_source.startswith("data:"):
                    header, encoded = current_image_source.split(",", 1)
                    original_b64 = encoded
                elif current_image_source.startswith("/"):
                    with open(current_image_source, "rb") as f:
                        original_b64 = base64.b64encode(f.read()).decode('utf-8')
                else:
                    async with httpx.AsyncClient() as client:
                        resp = await client.get(current_image_source, timeout=30)
                        original_b64 = base64.b64encode(resp.content).decode('utf-8')
                
                # Construct preprocessing prompt with visual style
                visual_style = req.visual_style_prompt or "Filmic realism, natural lighting, soft bokeh, 35mm lens, muted colors, subtle grain."
                
                preprocess_prompt = (
                    f"Role: Cinematic frame artist establishing the visual style.\n"
                    f"Goal: Transform this product image into a stylized opening frame.\n"
                    f"CRITICAL Main Subject: {hero_subject}\n"
                    f"Scene Setup: {first_prompt}\n"
                    f"Visual Style: {visual_style}\n"
                    f"Constraints: no text, 9:16 portrait aspect ratio, high fidelity, maintain product identity.\n"
                    f"Output: A stylized version of the product image with the specified visual style, ready for video generation."
                )
                
                # Call image generation API
                async with httpx.AsyncClient(timeout=120) as client:
                    result = await call_openai_compatible_api(
                        client, image_api_url, image_api_key,
                        original_b64,  # Input image
                        original_b64,  # Reference image (same for first frame)
                        "Preprocessing",
                        preprocess_prompt,
                        image_model
                    )
                    
                    if result and result.image_base64:
                        # Save preprocessed image
                        preprocessed_filename = f"chain_{chain_id}_preprocessed.jpg"
                        preprocessed_path = os.path.join("/app/uploads/queue", preprocessed_filename)
                        
                        preprocessed_data = base64.b64decode(result.image_base64)
                        with open(preprocessed_path, "wb") as f:
                            f.write(preprocessed_data)
                        
                        # Update image source to use preprocessed image
                        current_image_source = preprocessed_path
                        logging.info(f"Chain {chain_id}: Preprocessing complete, saved to {preprocessed_path}")
                    else:
                        logging.warning(f"Chain {chain_id}: Preprocessing returned no image, using original")
                        
            except Exception as preprocess_err:
                logging.warning(f"Chain {chain_id}: Preprocessing failed ({preprocess_err}), using original image")
            
            status["status"] = "processing"
            
            # === STEP 0.5: 分析预处理后的首帧，生成第一镜头的 prompt ===
            if image_api_url and image_api_key and len(req.shots) > 0:
                try:
                    logging.info(f"Chain {chain_id}: Analyzing preprocessed first frame...")
                    
                    # 读取预处理后的图片（或原始图片如果预处理失败）
                    if current_image_source.startswith("data:"):
                        header, encoded = current_image_source.split(",", 1)
                        first_frame_b64 = encoded
                    elif current_image_source.startswith("/"):
                        with open(current_image_source, "rb") as f:
                            first_frame_b64 = base64.b64encode(f.read()).decode('utf-8')
                    else:
                        async with httpx.AsyncClient() as client:
                            resp = await client.get(current_image_source, timeout=30)
                            first_frame_b64 = base64.b64encode(resp.content).decode('utf-8')
                    
                    # 获取第一镜头的场景信息
                    first_shot = req.shots[0]
                    first_description = first_shot.get("description", "")
                    first_story = first_shot.get("shotStory", "")
                    
                    # 运镜选项列表
                    camera_movements = [
                        "slow push-in (推进)",
                        "gentle pull-back (拉远)",
                        "smooth pan left/right (横摇)",
                        "subtle tilt up/down (俯仰)",
                        "orbit around subject (环绕)",
                        "static with subject motion (静态+主体运动)"
                    ]
                    
                    # 获取视觉风格
                    visual_style = req.visual_style_prompt or "Filmic realism, natural lighting, soft bokeh, 35mm lens, muted colors, subtle grain."
                    
                    # 获取运镜风格（用户指定或自动选择）
                    camera_instruction = ""
                    if req.camera_movement_prompt:
                        camera_instruction = f"   - CAMERA MOVEMENT: {req.camera_movement_prompt}\n"
                    else:
                        camera_instruction = f"   - CAMERA MOVEMENT: Choose one from: {', '.join(camera_movements)}\n"
                    
                    # 动态动作关键词列表
                    dynamic_actions = [
                        "rotating slowly", "floating gently", "rising/falling",
                        "rippling", "shimmering", "flowing", "drifting",
                        "particles floating in the air", "light beams shifting",
                        "steam/mist moving", "leaves drifting", "water flowing"
                    ]
                    
                    first_frame_analysis_prompt = (
                        f"You are a professional video director. Analyze this image and generate a DYNAMIC video prompt for the OPENING SHOT.\n\n"
                        f"SCENE CONTEXT:\n"
                        f"- Description: {first_description}\n"
                        f"- Story: {first_story}\n"
                        f"- VISUAL STYLE: {visual_style}\n\n"
                        f"⚠️ MANDATORY PRODUCT VISIBILITY RULES:\n"
                        f"1. The ENTIRE product must be FULLY VISIBLE in frame at ALL times\n"
                        f"2. NO extreme close-ups or macro shots that crop the product\n"
                        f"3. Use MEDIUM or WIDE shots only - keep product occupying 30-70% of frame\n"
                        f"4. Camera movement must be GENTLE - no aggressive push-ins\n"
                        f"5. Product must remain the HERO of every frame\n\n"
                        f"DYNAMIC REQUIREMENTS:\n"
                        f"1. Include REAL MOTION - NOT just static image with camera movement\n"
                        f"2. DYNAMIC ELEMENTS: {', '.join(dynamic_actions[:5])}\n"
                        f"3. Product can have subtle movements but must stay fully visible\n\n"
                        f"GENERATE A PROMPT WITH:\n"
                        f"   - Subject: Full product description, ALWAYS FULLY VISIBLE in frame\n"
                        f"   - Framing: Medium or wide shot, product centered, complete view\n"
                        f"{camera_instruction}"
                        f"   - Motion: Environmental dynamics (particles, light shifts) around the product\n"
                        f"   - Style: {visual_style}\n\n"
                        f"FORBIDDEN: extreme close-up, macro, tight crop, partial product view\n"
                        f"OUTPUT: A single paragraph prompt. Product must be FULLY VISIBLE throughout."
                    )
                    
                    async with httpx.AsyncClient(timeout=60) as client:
                        target_url = image_api_url
                        if not target_url.endswith("/chat/completions"):
                            target_url = f"{target_url.rstrip('/')}/chat/completions"
                        
                        payload = {
                            "model": analysis_model,
                            "messages": [
                                {"role": "user", "content": [
                                    {"type": "text", "text": first_frame_analysis_prompt},
                                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{first_frame_b64}"}}
                                ]}
                            ]
                        }
                        headers = {
                            "Content-Type": "application/json",
                            "Authorization": f"Bearer {image_api_key}"
                        }
                        
                        resp = await client.post(target_url, json=payload, headers=headers, timeout=60.0)
                        if resp.status_code == 200:
                            data = resp.json()
                            new_prompt = data.get("choices", [])[0].get("message", {}).get("content", "").strip()
                            if new_prompt:
                                # 设置 next_shot_prompt_override，这样第一镜头也会使用分析生成的 prompt
                                next_shot_prompt_override = new_prompt
                                logging.info(f"Chain {chain_id}: Generated first shot prompt: {new_prompt[:100]}...")
                        else:
                            logging.warning(f"Chain {chain_id}: First frame analysis API error: {resp.status_code}")
                except Exception as first_analysis_err:
                    logging.warning(f"Chain {chain_id}: First frame analysis failed: {first_analysis_err}, using original prompt")
        
        # Extract heroSubject from first shot for product consistency
        hero_subject = ""
        if len(req.shots) > 0:
            hero_subject = req.shots[0].get("heroSubject", "")
        
        # Log hero subject for debugging
        logging.info(f"Chain {chain_id}: heroSubject = '{hero_subject[:100]}...' " if hero_subject else f"Chain {chain_id}: heroSubject is empty - product consistency may be affected")
        
        for i, shot in enumerate(req.shots):
            shot_num = i + 1
            status["current_shot"] = shot_num
            logging.info(f"Chain {chain_id}: Starting Shot {shot_num}")
            
            # Create Queue Item
            db = SessionLocal()
            try:
                # Build prompt with strong product consistency enforcement
                base_prompt = shot.get("prompt", "")
                
                # Get product description - try current shot's heroSubject first, then global hero_subject, then description
                product_desc = shot.get("heroSubject", "") or hero_subject
                if not product_desc:
                    # Try to extract from shot description or use generic fallback
                    product_desc = shot.get("description", "the product shown in the image")
                
                # 如果上一镜头的尾帧分析生成了新的 prompt，则使用它替换原始脚本
                # 这确保产品一致性和视觉延续性
                if next_shot_prompt_override:
                    prompt_text = next_shot_prompt_override
                    logging.info(f"Chain {chain_id}: Using override prompt for shot {shot_num}")
                    # 重置，避免影响后续镜头
                    next_shot_prompt_override = None
                else:
                    # 第一个镜头或分析失败时使用原始 prompt
                    prompt_text = base_prompt
                
                queue_filename = f"chain_{chain_id}_shot_{shot_num}_input.jpg"
                queue_file_path = os.path.join("/app/uploads/queue", queue_filename)
                
                # Check if current_image_source is a local path (from extraction) or URL
                if current_image_source.startswith("/"):
                    # Local path
                    import shutil
                    shutil.copy(current_image_source, queue_file_path)
                elif current_image_source.startswith("data:"):
                     # Base64
                     header, encoded = current_image_source.split(",", 1)
                     data = base64.b64decode(encoded)
                     with open(queue_file_path, "wb") as f:
                         f.write(data)
                else:
                     # URL
                     async with httpx.AsyncClient() as client:
                         resp = await client.get(current_image_source, timeout=30)
                         with open(queue_file_path, "wb") as f:
                             f.write(resp.content)
                                 
                new_item = VideoQueueItem(
                    id=str(int(uuid.uuid4().int))[:18],
                    filename=queue_filename,
                    file_path=queue_file_path,
                    prompt=prompt_text,
                    status="pending",
                    user_id=user_id
                )
                db.add(new_item)
                db.commit()
                db.refresh(new_item)
                item_id = new_item.id
                status["video_ids"].append(item_id)
            finally:
                db.close()
            
            # Trigger Generation with retry mechanism (max 3 attempts)
            max_retries = 3
            for attempt in range(1, max_retries + 1):
                logging.info(f"Chain {chain_id}: Shot {shot_num} attempt {attempt}/{max_retries}")
                
                # Reset status for retry
                if attempt > 1:
                    db = SessionLocal()
                    retry_item = db.query(VideoQueueItem).filter(VideoQueueItem.id == item_id).first()
                    if retry_item:
                        retry_item.status = "pending"
                        retry_item.error_msg = None
                        db.commit()
                    db.close()
                
                await process_video_background(item_id, final_api_url, final_api_key, final_model)
                
                # Check result
                db = SessionLocal()
                completed_item = db.query(VideoQueueItem).filter(VideoQueueItem.id == item_id).first()
                
                if completed_item.status == "done":
                    logging.info(f"Chain {chain_id}: Shot {shot_num} completed successfully on attempt {attempt}")
                    result_url = completed_item.result_url
                    db.close()
                    break
                else:
                    error_msg = completed_item.error_msg or "Unknown error"
                    logging.warning(f"Chain {chain_id}: Shot {shot_num} attempt {attempt} failed: {error_msg}")
                    db.close()
                    
                    if attempt == max_retries:
                        logging.error(f"Chain {chain_id}: Shot {shot_num} failed after {max_retries} attempts")
                        status["status"] = "failed"
                        status["error"] = f"Shot {shot_num} failed after {max_retries} attempts: {error_msg}"
                        return
                    
                    # Wait before retry
                    await asyncio.sleep(5)
            
            # Get result_url after successful generation
            db = SessionLocal()
            completed_item = db.query(VideoQueueItem).filter(VideoQueueItem.id == item_id).first()
            result_url = completed_item.result_url
            db.close()
            
            # Local path resolution and download if needed
            # Wrap in a retry loop for download failures
            download_success = False
            download_retries = 3
            
            for download_attempt in range(1, download_retries + 1):
                if result_url.startswith("/uploads"):
                    local_video_path = f"/app{result_url}"
                    download_success = True
                    break
                elif result_url.startswith("http"):
                    # Convert to watermark-free URL if it's a Sora video
                    try:
                        converted_url = await convert_sora_to_watermark_free(result_url)
                        if converted_url and converted_url != result_url:
                            logging.info(f"Chain {chain_id}: Converted to watermark-free URL for shot {shot_num}")
                            result_url = converted_url
                    except Exception as wm_err:
                        logging.warning(f"Chain {chain_id}: Watermark removal failed for shot {shot_num}: {wm_err}")
                    
                    # Download remote video
                    try:
                        async with httpx.AsyncClient() as client:
                            resp = await client.get(result_url, timeout=300)
                            if resp.status_code == 200:
                                remote_filename = f"chain_{chain_id}_shot_{shot_num}_result.mp4"
                                local_video_path = f"/app/uploads/queue/{remote_filename}"
                                with open(local_video_path, "wb") as f:
                                    f.write(resp.content)
                                download_success = True
                                break
                            else:
                                logging.warning(f"Chain {chain_id}: Download failed for shot {shot_num} (attempt {download_attempt}/{download_retries}): HTTP {resp.status_code}")
                    except Exception as dl_err:
                        logging.warning(f"Chain {chain_id}: Download error for shot {shot_num} (attempt {download_attempt}/{download_retries}): {dl_err}")
                    
                    # If download failed and we have retries left, regenerate the video
                    if download_attempt < download_retries:
                        logging.info(f"Chain {chain_id}: Regenerating shot {shot_num} due to download failure...")
                        
                        # Reset the queue item status for regeneration
                        db = SessionLocal()
                        retry_item = db.query(VideoQueueItem).filter(VideoQueueItem.id == item_id).first()
                        if retry_item:
                            retry_item.status = "pending"
                            retry_item.result_url = None
                            retry_item.error_msg = None
                            db.commit()
                        db.close()
                        
                        # Wait before retry
                        await asyncio.sleep(5)
                        
                        # Regenerate video
                        await process_video_background(item_id, final_api_url, final_api_key, final_model)
                        
                        # Get new result_url
                        db = SessionLocal()
                        completed_item = db.query(VideoQueueItem).filter(VideoQueueItem.id == item_id).first()
                        if completed_item and completed_item.status == "done":
                            result_url = completed_item.result_url
                        else:
                            logging.warning(f"Chain {chain_id}: Regeneration failed for shot {shot_num}")
                            result_url = ""
                        db.close()
                else:
                    local_video_path = result_url
                    download_success = True
                    break
            
            if not download_success:
                status["status"] = "failed"
                status["error"] = f"Failed to download video for shot {shot_num} after {download_retries} attempts"
                return
            
            if i < len(req.shots) - 1:
                # Extract last frame for next shot
                extracted_path = extract_last_frame(local_video_path)
                if not extracted_path:
                    status["status"] = "failed"
                    status["error"] = f"Failed to extract frame from Shot {shot_num}"
                    return
                current_image_source = extracted_path
                
                # === 尾帧分析：保持产品一致性和延续性 ===
                next_shot_prompt_override = None
                if image_api_url and image_api_key:
                    try:
                        logging.info(f"Chain {chain_id}: Analyzing last frame for shot {shot_num + 1} continuity...")
                        with open(extracted_path, "rb") as f:
                            frame_b64 = base64.b64encode(f.read()).decode('utf-8')
                        
                        # 获取下一镜头的原始场景描述作为参考
                        next_shot = req.shots[i + 1]
                        next_shot_description = next_shot.get("description", "")
                        next_shot_story = next_shot.get("shotStory", "")
                        
                        # 运镜选项列表
                        camera_movements = [
                            "slow push-in (推进)",
                            "gentle pull-back (拉远)",
                            "smooth pan left/right (横摇)",
                            "subtle tilt up/down (俯仰)",
                            "orbit around subject (环绕)",
                            "dolly tracking (跟踪)",
                            "static with subject motion (静态+主体运动)"
                        ]
                        
                        # 获取视觉风格
                        visual_style = req.visual_style_prompt or "Filmic realism, natural lighting, soft bokeh, 35mm lens, muted colors, subtle grain."
                        
                        # 获取运镜风格（用户指定或自动选择）
                        camera_instruction = ""
                        if req.camera_movement_prompt:
                            camera_instruction = f"   - CAMERA MOVEMENT: {req.camera_movement_prompt}\n"
                        else:
                            camera_instruction = f"   - CAMERA MOVEMENT: Choose one from: {', '.join(camera_movements)}\n"
                        
                        # 动态动作关键词
                        dynamic_actions = [
                            "rotating", "floating", "rising", "falling", "rippling",
                            "shimmering", "flowing", "drifting", "swaying", "pulsing"
                        ]
                        
                        analysis_prompt = (
                            f"You are a professional video director ensuring continuity. Analyze this frame and generate a DYNAMIC video prompt.\n\n"
                            f"NEXT SHOT CONTEXT:\n"
                            f"- Scene: {next_shot_description}\n"
                            f"- Story: {next_shot_story}\n"
                            f"- Style: {visual_style}\n\n"
                            f"⚠️ MANDATORY PRODUCT VISIBILITY RULES:\n"
                            f"1. The ENTIRE product must be FULLY VISIBLE in frame at ALL times\n"
                            f"2. NO extreme close-ups or macro shots - product must NOT be cropped\n"
                            f"3. Use MEDIUM or WIDE shots only - product occupies 30-70% of frame\n"
                            f"4. Camera movement must be GENTLE - no aggressive push-ins\n"
                            f"5. Product appearance must MATCH the previous frame exactly\n\n"
                            f"DYNAMIC REQUIREMENTS:\n"
                            f"1. Include REAL MOTION - NOT just static image with camera movement\n"
                            f"2. DYNAMIC ELEMENTS: {', '.join(dynamic_actions[:6])}\n"
                            f"3. Background can evolve but product stays fully visible\n\n"
                            f"GENERATE A PROMPT WITH:\n"
                            f"   - Subject: COMPLETE product view, matching previous frame exactly\n"
                            f"   - Framing: Medium/wide shot, product centered and FULLY VISIBLE\n"
                            f"{camera_instruction}"
                            f"   - Environment: Evolving background (light shifts, particles) around product\n"
                            f"   - Continuity: Seamless transition, same product appearance\n\n"
                            f"FORBIDDEN: extreme close-up, macro, tight crop, partial product view\n"
                            f"OUTPUT: A single paragraph prompt. Product must be FULLY VISIBLE throughout."
                        )
                        
                        async with httpx.AsyncClient(timeout=60) as client:
                            target_url = image_api_url
                            if not target_url.endswith("/chat/completions"):
                                target_url = f"{target_url.rstrip('/')}/chat/completions"
                            
                            payload = {
                                "model": analysis_model,
                                "messages": [
                                    {"role": "user", "content": [
                                        {"type": "text", "text": analysis_prompt},
                                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"}}
                                    ]}
                                ]
                            }
                            headers = {
                                "Content-Type": "application/json",
                                "Authorization": f"Bearer {image_api_key}"
                            }
                            
                            resp = await client.post(target_url, json=payload, headers=headers, timeout=60.0)
                            if resp.status_code == 200:
                                data = resp.json()
                                new_prompt = data.get("choices", [])[0].get("message", {}).get("content", "").strip()
                                if new_prompt:
                                    next_shot_prompt_override = new_prompt
                                    logging.info(f"Chain {chain_id}: Generated continuity prompt for shot {shot_num + 1}: {new_prompt[:100]}...")
                            else:
                                logging.warning(f"Chain {chain_id}: Frame analysis API error: {resp.status_code}")
                    except Exception as analysis_err:
                        logging.warning(f"Chain {chain_id}: Frame analysis failed: {analysis_err}, using original prompt")
        
        # Merge Logic
        logging.info(f"Chain {chain_id}: All shots done. Merging...")
        status["status"] = "merging"
        
        inputs = []
        db = SessionLocal()
        for i, vid_id in enumerate(status["video_ids"]):
             # We can't rely just on DB result_url because we might have downloaded it locally above.
             # But we didn't store the local path in DB. 
             # Re-construct the expected local path logic.
             v = db.query(VideoQueueItem).filter(VideoQueueItem.id == vid_id).first()
             if v and v.result_url:
                 if v.result_url.startswith("/uploads"):
                     inputs.append(f"/app{v.result_url}")
                 elif v.result_url.startswith("http"):
                     # Re-construct downloaded filename
                     shot_n = i + 1
                     inputs.append(f"/app/uploads/queue/chain_{chain_id}_shot_{shot_n}_result.mp4")
                 else:
                     inputs.append(v.result_url)
        db.close()
        
        if len(inputs) > 0:
            concat_list_path = f"/app/uploads/queue/chain_{chain_id}_concat.txt"
            with open(concat_list_path, "w") as f:
                for path in inputs:
                    f.write(f"file '{path}'\n")
            
            output_filename = f"story_chain_{chain_id}.mp4"
            output_path = f"/app/uploads/queue/{output_filename}"
            
            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_list_path,
                "-c", "copy",
                output_path
            ]
            subprocess.run(cmd, check=True)
            
            final_result_url = f"/uploads/queue/{output_filename}"
            status["merged_video_url"] = final_result_url
            status["status"] = "completed"
            
            # Generate thumbnail from first frame
            thumbnail_filename = f"story_chain_{chain_id}_thumb.jpg"
            thumbnail_path = f"/app/uploads/queue/{thumbnail_filename}"
            try:
                thumb_cmd = [
                    "ffmpeg", "-y",
                    "-i", output_path,
                    "-ss", "00:00:00.500",  # 0.5 second into video
                    "-vframes", "1",
                    "-q:v", "2",  # High quality
                    thumbnail_path
                ]
                subprocess.run(thumb_cmd, check=True, capture_output=True)
                preview_url = f"/uploads/queue/{thumbnail_filename}"
                logging.info(f"Chain {chain_id}: Thumbnail generated at {preview_url}")
            except Exception as thumb_err:
                logging.warning(f"Chain {chain_id}: Failed to generate thumbnail: {thumb_err}")
                preview_url = None
            
            # Add merged result to queue with preview
            db = SessionLocal()
            merged_item = VideoQueueItem(
                id=str(int(uuid.uuid4().int))[:18],
                filename=output_filename,
                file_path=output_path,
                prompt=f"Story Chain {chain_id} Complete",
                status="done",
                result_url=final_result_url,
                user_id=user_id,
                is_merged=True  # Mark as merged/composite video
            )
            # Set preview_url if thumbnail was generated
            if preview_url:
                merged_item.preview_url = preview_url
            db.add(merged_item)
            db.commit()
            db.close()
            
        # Clear user activity status
        try:
            await connection_manager.update_user_activity(user_id, "")
        except Exception:
            pass
            
    except Exception as e:
        logging.error(f"Chain {chain_id} Critical Error: {e}")
        status["status"] = "failed"
        status["error"] = str(e)
        
        # Clear user activity on error too
        try:
            await connection_manager.update_user_activity(user_id, "")
        except Exception:
            pass

@app.post("/api/v1/story-chain")
async def create_story_chain(
    req: StoryChainRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user)
):
    chain_id = str(uuid.uuid4())
    
    # Update user activity status
    try:
        await connection_manager.update_user_activity(user.id, f"故事链生成中 ({len(req.shots)}镜头)")
    except Exception:
        pass  # WebSocket not required
    
    background_tasks.add_task(process_story_chain, chain_id, req, user.id)
    return {"chain_id": chain_id, "status": "started"}

@app.get("/api/v1/story-chain/{chain_id}")
async def get_story_chain_status(chain_id: str):
    status = STORY_CHAIN_STATUS.get(chain_id)
    if not status:
        raise HTTPException(status_code=404, detail="Chain not found")
    return status


# =============================================================================
# Story Fission Implementation (裂变式故事生成)
# =============================================================================

class StoryFissionRequest(BaseModel):
    initial_image_url: str  # Base64 or URL
    topic: str = "产品多角度展示"
    branch_count: int = 3  # Number of branches to generate
    visual_style: Optional[str] = None
    visual_style_prompt: Optional[str] = None
    camera_movement: Optional[str] = None
    camera_movement_prompt: Optional[str] = None
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None

class FissionBranch(BaseModel):
    branch_id: int
    scene_name: str
    theme: str
    image_prompt: str
    video_prompt: str
    camera_movement: str

STORY_FISSION_STATUS = {}
FISSION_CONCURRENT_LIMIT = 3  # 3 branches at a time

async def analyze_fission_branches(
    image_b64: str,
    topic: str,
    branch_count: int,
    visual_style_prompt: str,
    api_url: str,
    api_key: str,
    model_name: str
) -> List[dict]:
    """Analyze image and generate multiple story branches."""
    
    fission_prompt = f"""Role: 你是一位资深创意总监 + 产品摄影专家，负责将一张产品图片裂变成多个灵动、有表现力的故事分支。

=== 第一步：产品深度分析 ===
首先，仔细观察图片中的产品，识别并分析：
1. **产品类型与用途**：这是什么产品？主要功能是什么？解决什么问题？
2. **核心特写卖点**：材质质感、工艺细节、按钮/接口、品牌标识、独特设计元素
3. **使用场景联想**：谁会使用？在哪里使用？什么时间使用？
4. **情感价值**：传达什么情绪？科技感？温馨？专业？时尚？

=== 第二步：生成 {branch_count} 个裂变分支 ===
基于以上分析，创作 {branch_count} 个不同的剧情场景分支：

=== 分支创作要求 ===
1. 每个分支必须**突出产品的一个独特卖点或使用场景**
2. **灵动镜头**：避免静态呆板，加入动态元素：
   - 手部交互（触摸、按压、滑动）
   - 环境动态（光线变化、烟雾、水流、粒子）
   - 产品自身动态（旋转、展开、发光、工作状态）
3. **特写与全景结合**：每个分支中既有产品全貌，也有局部特写细节
4. **感官描述**：描述材质触感、光泽反射、声音暗示（如按键声、流水声）
5. 产品始终作为**视觉焦点**，占画面30-70%

=== 视觉风格 ===
{visual_style_prompt or 'Cinematic realism, natural lighting, soft bokeh, 35mm lens, rich textures.'}

=== 运镜选项（选择最能展现该场景特点的运镜）===
- slow push-in (推进) - 适合强调细节
- gentle pull-back (拉远) - 适合展示使用场景
- smooth orbit (环绕) - 适合展示产品全貌
- dolly tracking (跟踪) - 适合跟随手部交互
- macro focus shift (焦点转移) - 适合特写局部
- static with motion (静态+元素运动) - 适合产品工作状态

=== 动态元素关键词库（每个分支至少用2-3个）===
floating particles, light rays shifting, steam rising, water droplets, 
gentle rotation, finger touching, hand interacting, unboxing reveal,
product powering on, LED glowing, screen displaying, texture close-up,
material reflection, smooth sliding, button pressing, liquid pouring

=== 输出格式 ===
输出 JSON 数组，每个分支包含：
[
  {{
    "branch_id": 1,
    "scene_name": "场景名称（中文，如：晨光中的唤醒仪式）",
    "theme": "主题描述（中文，2-3句话，描述这个场景要传达的产品卖点和情感）",
    "product_focus": "该分支突出的产品特点（中文，如：按键触感、材质光泽、使用便捷性）",
    "image_prompt": "详细的图片生成 prompt（英文），包含：主体描述、特写细节、光影氛围、动态元素暗示",
    "video_prompt": "详细的视频生成 prompt（英文），必须包含：具体的动态动作、运动元素、光影变化、情绪氛围",
    "camera_movement": "推荐运镜（从上述选项中选择）"
  }},
  ...
]

=== 故事主题 ===
{topic}

只输出 JSON 数组，不要包含 markdown 代码块或其他说明文字。
"""

    target_url = api_url
    if not target_url.endswith("/chat/completions"):
        target_url = f"{target_url.rstrip('/')}/chat/completions"
    
    payload = {
        "model": model_name,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": fission_prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}}
                ]
            }
        ],
        "max_tokens": 4096
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    max_retries = 3
    retry_delay = 5
    
    for attempt in range(1, max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=120) as client:  # Increased timeout
                resp = await client.post(target_url, json=payload, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    content = data.get("choices", [])[0].get("message", {}).get("content", "").strip()
                    
                    # Clean markdown if present
                    if content.startswith("```"):
                        lines = content.splitlines()
                        if lines[0].startswith("```"):
                            lines = lines[1:]
                        if lines and lines[-1].strip().startswith("```"):
                            lines = lines[:-1]
                        content = "\n".join(lines).strip()
                    
                    import re
                    content = re.sub(r',\s*\}', '}', content)
                    content = re.sub(r',\s*\]', ']', content)
                    
                    branches = json.loads(content)
                    return branches
                    
                elif resp.status_code in [502, 503, 504, 429]:
                    logging.warning(f"Fission analysis attempt {attempt}: HTTP {resp.status_code}, retrying...")
                    if attempt < max_retries:
                        await asyncio.sleep(retry_delay * attempt)
                        continue
                    raise Exception(f"Fission analysis API error after {max_retries} attempts: {resp.status_code}")
                else:
                    raise Exception(f"Fission analysis API error: {resp.status_code} - {resp.text[:200]}")
                    
        except httpx.TimeoutException:
            logging.warning(f"Fission analysis timeout on attempt {attempt}")
            if attempt < max_retries:
                await asyncio.sleep(retry_delay)
                continue
            raise Exception(f"Fission analysis timed out after {max_retries} attempts")
        except json.JSONDecodeError as e:
            logging.warning(f"Fission analysis JSON parse error on attempt {attempt}: {e}")
            if attempt < max_retries:
                await asyncio.sleep(retry_delay)
                continue
            raise


async def generate_branch_image(
    branch: dict,
    original_b64: str,
    fission_id: str,
    image_api_url: str,
    image_api_key: str,
    image_model: str,
    user_id: int = None  # NEW: for gallery save
) -> str:
    """Generate a stylized image for a branch with retry mechanism. Returns local file path."""
    branch_id = branch.get("branch_id", 0)
    image_prompt = branch.get("image_prompt", "")
    scene_name = branch.get("scene_name", f"分支{branch_id}")
    
    max_retries = 3
    retry_delay = 5  # seconds between retries
    
    for attempt in range(1, max_retries + 1):
        try:
            logging.info(f"Fission {fission_id}: Generating image for branch {branch_id} (attempt {attempt}/{max_retries})")
            
            async with httpx.AsyncClient(timeout=300) as client:  # Increased timeout to 5 min
                result = await call_openai_compatible_api(
                    client, image_api_url, image_api_key,
                    original_b64,  # Input image
                    original_b64,  # Reference image
                    f"Branch_{branch_id}",
                    image_prompt,
                    image_model
                )
                
                if result and result.image_base64:
                    raw_content = result.image_base64.strip()
                    image_data = None
                    
                    # Check if API returned a URL (common for some image generation APIs)
                    if raw_content.startswith("http://") or raw_content.startswith("https://"):
                        logging.info(f"Fission {fission_id}: Branch {branch_id} - downloading image from URL")
                        try:
                            async with httpx.AsyncClient(timeout=120) as dl_client:
                                img_resp = await dl_client.get(raw_content)
                                if img_resp.status_code == 200:
                                    image_data = img_resp.content
                                else:
                                    raise Exception(f"Failed to download image: HTTP {img_resp.status_code}")
                        except Exception as dl_err:
                            logging.warning(f"Fission {fission_id}: Branch {branch_id} URL download failed: {dl_err}")
                            raise Exception(f"Branch {branch_id}: Failed to download image from URL")
                    
                    # Check for data:image prefix
                    elif raw_content.startswith("data:"):
                        # Extract base64 part: data:image/jpeg;base64,XXXXX
                        if ",base64," in raw_content:
                            b64_data = raw_content.split(",base64,", 1)[1]
                        elif "," in raw_content:
                            b64_data = raw_content.split(",", 1)[1]
                        else:
                            b64_data = raw_content
                        
                        # Fix padding if needed
                        missing_padding = len(b64_data) % 4
                        if missing_padding:
                            b64_data += '=' * (4 - missing_padding)
                        
                        try:
                            image_data = base64.b64decode(b64_data)
                        except Exception as decode_err:
                            logging.warning(f"Fission {fission_id}: Branch {branch_id} base64 decode failed: {decode_err}")
                            raise Exception(f"Branch {branch_id}: Invalid base64 image data")
                    
                    # Assume raw base64 content
                    else:
                        b64_data = raw_content
                        
                        # Check if content looks like base64 (not text description)
                        if len(b64_data) < 1000:
                            logging.warning(f"Fission {fission_id}: Branch {branch_id} returned short content: {b64_data[:200]}")
                            raise Exception(f"Branch {branch_id}: API returned text description instead of image")
                        
                        # Fix padding if needed
                        missing_padding = len(b64_data) % 4
                        if missing_padding:
                            b64_data += '=' * (4 - missing_padding)
                        
                        try:
                            image_data = base64.b64decode(b64_data)
                        except Exception as decode_err:
                            logging.warning(f"Fission {fission_id}: Branch {branch_id} base64 decode failed: {decode_err}")
                            raise Exception(f"Branch {branch_id}: Invalid base64 image data")
                    
                    if not image_data:
                        raise Exception(f"Branch {branch_id}: No image data obtained")
                    
                    # Convert to standard JPEG using PIL for video API compatibility
                    from PIL import Image
                    from io import BytesIO
                    
                    try:
                        img = Image.open(BytesIO(image_data))
                    except Exception as pil_err:
                        logging.warning(f"Fission {fission_id}: Branch {branch_id} PIL cannot open: {pil_err}")
                        raise Exception(f"Branch {branch_id}: Cannot parse image data")
                    
                    # Convert to RGB if necessary (handles RGBA, P mode etc)
                    if img.mode in ('RGBA', 'P', 'LA'):
                        img = img.convert('RGB')
                    
                    img_width, img_height = img.size
                    
                    # Save to queue folder (for video generation input)
                    queue_filename = f"fission_{fission_id}_branch_{branch_id}.jpg"
                    queue_filepath = f"/app/uploads/queue/{queue_filename}"
                    img.save(queue_filepath, 'JPEG', quality=95)
                    logging.info(f"Fission {fission_id}: Branch {branch_id} image saved to {queue_filepath}")
                    
                    # Also save to gallery
                    gallery_dir = "/app/uploads/gallery"
                    os.makedirs(gallery_dir, exist_ok=True)
                    gallery_filename = f"fission_{fission_id}_{branch_id}_{scene_name[:20]}.jpg"
                    # Sanitize filename
                    gallery_filename = "".join(c if c.isalnum() or c in '._-' else '_' for c in gallery_filename)
                    gallery_filepath = os.path.join(gallery_dir, gallery_filename)
                    img.save(gallery_filepath, 'JPEG', quality=95)
                    
                    # Create gallery database record
                    if user_id:
                        try:
                            db = SessionLocal()
                            gallery_item = SavedImage(
                                user_id=user_id,
                                filename=gallery_filename,
                                file_path=gallery_filepath,
                                url=f"/uploads/gallery/{gallery_filename}",
                                prompt=f"[Fission] {scene_name}: {image_prompt[:200]}",
                                width=img_width,
                                height=img_height,
                                category="fission"
                            )
                            db.add(gallery_item)
                            db.commit()
                            db.close()
                            logging.info(f"Fission {fission_id}: Branch {branch_id} image saved to gallery")
                        except Exception as gallery_err:
                            logging.warning(f"Fission {fission_id}: Gallery save error: {gallery_err}")
                    
                    return queue_filepath
                else:
                    raise Exception(f"Branch {branch_id} image generation returned no result")
                    
        except httpx.TimeoutException as e:
            logging.warning(f"Fission {fission_id}: Branch {branch_id} timeout on attempt {attempt}: {e}")
            if attempt < max_retries:
                await asyncio.sleep(retry_delay)
                continue
            raise Exception(f"Branch {branch_id} timed out after {max_retries} attempts")
            
        except httpx.HTTPStatusError as e:
            logging.warning(f"Fission {fission_id}: Branch {branch_id} HTTP error on attempt {attempt}: {e.response.status_code}")
            if attempt < max_retries and e.response.status_code in [502, 503, 504, 429]:
                await asyncio.sleep(retry_delay * attempt)  # Exponential backoff
                continue
            raise
            
        except Exception as e:
            error_msg = str(e)
            logging.warning(f"Fission {fission_id}: Branch {branch_id} error on attempt {attempt}: {error_msg}")
            if attempt < max_retries and ("timeout" in error_msg.lower() or "504" in error_msg or "503" in error_msg):
                await asyncio.sleep(retry_delay)
                continue
            raise
    
    raise Exception(f"Branch {branch_id} failed after {max_retries} attempts")


async def generate_branch_video(
    branch: dict,
    image_path: str,
    fission_id: str,
    video_api_url: str,
    video_api_key: str,
    video_model: str,
    user_id: int
) -> dict:
    """Generate video for a branch. Returns result dict."""
    branch_id = branch.get("branch_id", 0)
    video_prompt = branch.get("video_prompt", "")
    camera = branch.get("camera_movement", "")
    
    full_prompt = f"{video_prompt} Camera: {camera}"
    
    logging.info(f"Fission {fission_id}: Generating video for branch {branch_id}")
    
    # Create queue item
    db = SessionLocal()
    try:
        queue_filename = f"fission_{fission_id}_branch_{branch_id}_input.jpg"
        queue_file_path = f"/app/uploads/queue/{queue_filename}"
        
        import shutil
        shutil.copy(image_path, queue_file_path)
        
        new_item = VideoQueueItem(
            id=str(int(uuid.uuid4().int))[:18],
            filename=queue_filename,
            file_path=queue_file_path,
            prompt=full_prompt,
            status="pending",
            user_id=user_id
        )
        db.add(new_item)
        db.commit()
        db.refresh(new_item)
        item_id = new_item.id
    finally:
        db.close()
    
    # Generate video with retry
    max_retries = 3
    for attempt in range(1, max_retries + 1):
        if attempt > 1:
            db = SessionLocal()
            retry_item = db.query(VideoQueueItem).filter(VideoQueueItem.id == item_id).first()
            if retry_item:
                retry_item.status = "pending"
                retry_item.error_msg = None
                db.commit()
            db.close()
        
        await process_video_background(item_id, video_api_url, video_api_key, video_model)
        
        db = SessionLocal()
        completed_item = db.query(VideoQueueItem).filter(VideoQueueItem.id == item_id).first()
        
        if completed_item.status == "done":
            result_url = completed_item.result_url
            db.close()
            
            # Download if remote
            local_video_path = None
            if result_url.startswith("/uploads"):
                local_video_path = f"/app{result_url}"
            elif result_url.startswith("http"):
                try:
                    result_url = await convert_sora_to_watermark_free(result_url)
                    async with httpx.AsyncClient() as client:
                        resp = await client.get(result_url, timeout=300)
                        if resp.status_code == 200:
                            local_filename = f"fission_{fission_id}_branch_{branch_id}_result.mp4"
                            local_video_path = f"/app/uploads/queue/{local_filename}"
                            with open(local_video_path, "wb") as f:
                                f.write(resp.content)
                except Exception as dl_err:
                    logging.warning(f"Fission {fission_id}: Branch {branch_id} download error: {dl_err}")
            
            return {
                "branch_id": branch_id,
                "scene_name": branch.get("scene_name", ""),
                "theme": branch.get("theme", ""),
                "video_url": f"/uploads/queue/fission_{fission_id}_branch_{branch_id}_result.mp4" if (local_video_path and os.path.exists(local_video_path)) else result_url,
                "local_video_path": local_video_path if (local_video_path and os.path.exists(local_video_path)) else None,
                "image_url": f"/uploads/queue/fission_{fission_id}_branch_{branch_id}.jpg",
                "status": "done"
            }
        else:
            error_msg = completed_item.error_msg or "Unknown error"
            db.close()
            if attempt == max_retries:
                return {
                    "branch_id": branch_id,
                    "status": "error",
                    "error": error_msg
                }
            await asyncio.sleep(5)
    
    return {"branch_id": branch_id, "status": "error", "error": "Max retries exceeded"}


async def process_story_fission(fission_id: str, req: StoryFissionRequest, user_id: int):
    """Main fission processing function with 3-concurrent batching."""
    status = {
        "status": "processing",
        "phase": "analyzing",
        "total_branches": req.branch_count,
        "completed_branches": 0,
        "branches": [],
        "error": None
    }
    STORY_FISSION_STATUS[fission_id] = status
    
    # Config resolution
    db = SessionLocal()
    db_config_list = db.query(SystemConfig).all()
    config_dict = {item.key: item.value for item in db_config_list}
    db.close()
    
    image_api_url = req.api_url or config_dict.get("api_url", "")
    image_api_key = req.api_key or config_dict.get("api_key", "")
    image_model = config_dict.get("model_name", "gemini-3-pro-image-preview")  # Use same as settings
    analysis_model = config_dict.get("analysis_model_name", "gemini-3-pro-preview")
    
    video_api_url = config_dict.get("video_api_url", "")
    video_api_key = config_dict.get("video_api_key", "")
    video_model = req.model_name or config_dict.get("video_model_name", "sora-video-portrait")
    
    try:
        # Step 1: Decode original image
        logging.info(f"Fission {fission_id}: Starting with {req.branch_count} branches")
        
        if req.initial_image_url.startswith("data:"):
            header, encoded = req.initial_image_url.split(",", 1)
            original_b64 = encoded
        else:
            async with httpx.AsyncClient() as client:
                resp = await client.get(req.initial_image_url, timeout=30)
                original_b64 = base64.b64encode(resp.content).decode('utf-8')
        
        # Step 2: Analyze and generate branches
        status["phase"] = "analyzing"
        logging.info(f"Fission {fission_id}: Analyzing image to generate {req.branch_count} branches")
        
        branches = await analyze_fission_branches(
            original_b64,
            req.topic,
            req.branch_count,
            req.visual_style_prompt or "",
            image_api_url,
            image_api_key,
            analysis_model
        )
        
        logging.info(f"Fission {fission_id}: Generated {len(branches)} branch scripts")
        status["branches"] = [{"branch_id": b.get("branch_id"), "scene_name": b.get("scene_name"), "status": "pending"} for b in branches]
        
        # Step 3: Generate images in batches of 3
        status["phase"] = "generating_images"
        os.makedirs("/app/uploads/queue", exist_ok=True)
        
        image_paths = {}
        for i in range(0, len(branches), FISSION_CONCURRENT_LIMIT):
            batch = branches[i:i + FISSION_CONCURRENT_LIMIT]
            logging.info(f"Fission {fission_id}: Image batch {i//FISSION_CONCURRENT_LIMIT + 1}, {len(batch)} branches")
            
            tasks = [
                generate_branch_image(b, original_b64, fission_id, image_api_url, image_api_key, image_model, user_id)
                for b in batch
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for j, result in enumerate(results):
                branch_id = batch[j].get("branch_id", i + j + 1)
                if isinstance(result, Exception):
                    logging.error(f"Fission {fission_id}: Branch {branch_id} image error: {result}")
                    status["branches"][i + j]["status"] = "image_error"
                else:
                    image_paths[branch_id] = result
                    status["branches"][i + j]["status"] = "image_done"
                    status["branches"][i + j]["image_url"] = f"/uploads/queue/fission_{fission_id}_branch_{branch_id}.jpg"
        
        # Step 4: Generate videos in batches of 3
        status["phase"] = "generating_videos"
        
        for i in range(0, len(branches), FISSION_CONCURRENT_LIMIT):
            batch = branches[i:i + FISSION_CONCURRENT_LIMIT]
            logging.info(f"Fission {fission_id}: Video batch {i//FISSION_CONCURRENT_LIMIT + 1}, {len(batch)} branches")
            
            tasks = []
            for b in batch:
                branch_id = b.get("branch_id", 0)
                if branch_id in image_paths:
                    tasks.append(generate_branch_video(
                        b, image_paths[branch_id], fission_id,
                        video_api_url, video_api_key, video_model, user_id
                    ))
            
            if tasks:
                results = await asyncio.gather(*tasks, return_exceptions=True)
                
                for j, result in enumerate(results):
                    if isinstance(result, Exception):
                        logging.error(f"Fission {fission_id}: Video error: {result}")
                    elif isinstance(result, dict):
                        branch_id = result.get("branch_id", 0)
                        # Find and update the branch status
                        for bi, bs in enumerate(status["branches"]):
                            if bs.get("branch_id") == branch_id:
                                status["branches"][bi].update(result)
                                if result.get("status") == "done":
                                    status["completed_branches"] += 1
                                break
        
        # Step 5: Merge all successful videos into one
        status["phase"] = "merging"
        logging.info(f"Fission {fission_id}: Merging {status['completed_branches']} videos...")
        
        # Collect successful video paths (validate existence)
        video_inputs = []
        for branch in status["branches"]:
            if branch.get("status") == "done":
                # Prefer local video path
                local_path = branch.get("local_video_path")
                if local_path and os.path.exists(local_path):
                    video_inputs.append(local_path)
                else:
                    # Try to construct path from video_url
                    video_url = branch.get("video_url", "")
                    if video_url.startswith("/uploads"):
                        full_path = f"/app{video_url}"
                        if os.path.exists(full_path):
                            video_inputs.append(full_path)
                        else:
                            logging.warning(f"Fission {fission_id}: Video file not found: {full_path}")
                    # Skip remote URLs for now (not downloaded)
        
        logging.info(f"Fission {fission_id}: Found {len(video_inputs)} local videos to merge")
        
        if len(video_inputs) > 0:
            # Create concat list file
            concat_list_path = f"/app/uploads/queue/fission_{fission_id}_concat.txt"
            with open(concat_list_path, "w") as f:
                for path in video_inputs:
                    f.write(f"file '{path}'\n")
            
            # Merge videos using ffmpeg
            output_filename = f"story_fission_{fission_id}.mp4"
            output_path = f"/app/uploads/queue/{output_filename}"
            
            try:
                # Try fast copy first
                merge_cmd = [
                    "ffmpeg", "-y",
                    "-f", "concat",
                    "-safe", "0",
                    "-i", concat_list_path,
                    "-c", "copy",
                    output_path
                ]
                result = subprocess.run(merge_cmd, capture_output=True, text=True)
                
                if result.returncode != 0:
                    logging.warning(f"Fission {fission_id}: Fast merge failed ({result.returncode}), trying re-encode...")
                    # Fallback: re-encode for compatibility
                    merge_cmd_reencode = [
                        "ffmpeg", "-y",
                        "-f", "concat",
                        "-safe", "0",
                        "-i", concat_list_path,
                        "-c:v", "libx264",
                        "-c:a", "aac",
                        "-preset", "fast",
                        output_path
                    ]
                    subprocess.run(merge_cmd_reencode, check=True, capture_output=True)
                
                if os.path.exists(output_path):
                    final_result_url = f"/uploads/queue/{output_filename}"
                    status["merged_video_url"] = final_result_url
                else:
                    raise Exception("Merged video file not created")
                    
            except subprocess.CalledProcessError as ffmpeg_err:
                logging.error(f"Fission {fission_id}: FFmpeg merge failed: {ffmpeg_err}")
                status["error"] = f"Video merge failed: {ffmpeg_err}"
                status["status"] = "failed"
                return
            
            # Generate thumbnail
            thumbnail_filename = f"story_fission_{fission_id}_thumb.jpg"
            thumbnail_path = f"/app/uploads/queue/{thumbnail_filename}"
            try:
                thumb_cmd = [
                    "ffmpeg", "-y",
                    "-i", output_path,
                    "-ss", "00:00:00.500",
                    "-vframes", "1",
                    "-q:v", "2",
                    thumbnail_path
                ]
                subprocess.run(thumb_cmd, check=True, capture_output=True)
                status["thumbnail_url"] = f"/uploads/queue/{thumbnail_filename}"
            except Exception as thumb_err:
                logging.warning(f"Fission {fission_id}: Thumbnail generation failed: {thumb_err}")
            
            # Add merged result to queue
            db = SessionLocal()
            merged_item = VideoQueueItem(
                id=str(int(uuid.uuid4().int))[:18],
                filename=output_filename,
                file_path=output_path,
                prompt=f"Story Fission {fission_id} - {req.topic}",
                status="done",
                result_url=final_result_url,
                user_id=user_id,
                is_merged=True  # Mark as merged/composite video
            )
            if status.get("thumbnail_url"):
                merged_item.preview_url = status["thumbnail_url"]
            db.add(merged_item)
            db.commit()
            db.close()
            
            logging.info(f"Fission {fission_id}: Merged video saved to {final_result_url}")
        
        status["status"] = "completed"
        status["phase"] = "done"
        logging.info(f"Fission {fission_id}: Completed with {status['completed_branches']}/{len(branches)} successful branches")
        
        # Clear user activity status
        try:
            await connection_manager.update_user_activity(user_id, "")
        except Exception:
            pass
        
    except Exception as e:
        logging.error(f"Fission {fission_id} Critical Error: {e}")
        import traceback
        traceback.print_exc()
        status["status"] = "failed"
        status["error"] = str(e)
        
        # Clear user activity on error too
        try:
            await connection_manager.update_user_activity(user_id, "")
        except Exception:
            pass


@app.post("/api/v1/story-fission")
async def create_story_fission(
    req: StoryFissionRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user)
):
    """Start a fission-style story generation (parallel branches)."""
    fission_id = str(uuid.uuid4())
    
    # Update user activity status
    try:
        await connection_manager.update_user_activity(user.id, f"裂变生成中 ({req.branch_count}分支)")
    except Exception:
        pass  # WebSocket not required
    
    background_tasks.add_task(process_story_fission, fission_id, req, user.id)
    return {"fission_id": fission_id, "status": "started", "branch_count": req.branch_count}


@app.get("/api/v1/story-fission/{fission_id}")
async def get_story_fission_status(fission_id: str):
    """Get the status of a fission generation."""
    status = STORY_FISSION_STATUS.get(fission_id)
    if not status:
        raise HTTPException(status_code=404, detail="Fission not found")
    return status


# =============================================================================
# WebSocket Endpoint for Real-time Updates
# =============================================================================

def verify_ws_token(token: str, db: Session) -> Optional[User]:
    """Verify JWT token for WebSocket connection."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            return None
        user = db.query(User).filter(User.username == username).first()
        return user
    except JWTError:
        return None


@app.websocket("/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str):
    """
    WebSocket endpoint for real-time updates.
    
    Clients connect with their JWT token and receive:
    - Task progress updates
    - Queue status changes
    - System notifications
    """
    db = SessionLocal()
    try:
        user = verify_ws_token(token, db)
        if not user:
            await websocket.close(code=4001, reason="Invalid token")
            return
        
        # Connect the WebSocket
        await connection_manager.connect(
            websocket=websocket,
            user_id=user.id,
            username=user.username,
            is_admin=(user.role == "admin")
        )
        
        try:
            # Keep connection alive and handle incoming messages
            while True:
                # Wait for messages (ping/pong or commands)
                data = await websocket.receive_text()
                
                # Handle ping
                if data == "ping":
                    await websocket.send_text("pong")
                
                # Handle activity updates from client
                elif data.startswith("activity:"):
                    activity = data[9:]
                    await connection_manager.update_user_activity(user.id, activity)
                
        except WebSocketDisconnect:
            await connection_manager.disconnect(websocket, user.id)
    finally:
        db.close()


# =============================================================================
# Admin Monitoring API
# =============================================================================

@app.get("/api/v1/admin/live-status")
async def get_admin_live_status(
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """
    Get real-time system status for admin dashboard.
    
    Returns:
    - Online users
    - Active tasks
    - Queue statistics
    - Recent activities
    """
    # Get online users from WebSocket manager
    online_users = connection_manager.get_online_users()
    
    # Get queue stats from Redis
    try:
        task_queue = await get_task_queue()
        queue_stats = await task_queue.get_queue_stats()
    except Exception as e:
        logger.warning(f"Failed to get queue stats: {e}")
        queue_stats = {"error": str(e)}
    
    # Get recent activities from database (last 12 hours only)
    twelve_hours_ago = get_china_now() - timedelta(hours=12)
    recent_activities = db.query(UserActivity).filter(
        UserActivity.created_at >= twelve_hours_ago
    ).order_by(
        UserActivity.created_at.desc()
    ).limit(50).all()
    
    activities_list = [
        {
            "id": a.id,
            "user_id": a.user_id,
            "action": a.action,
            "details": a.details,
            "created_at": a.created_at.isoformat() if a.created_at else None
        }
        for a in recent_activities
    ]
    
    # Get current processing counts
    video_processing = db.query(VideoQueueItem).filter(
        VideoQueueItem.status == "processing"
    ).count()
    
    video_pending = db.query(VideoQueueItem).filter(
        VideoQueueItem.status == "pending"
    ).count()
    
    # Count active fission tasks
    active_fission_tasks = sum(
        1 for s in STORY_FISSION_STATUS.values() 
        if s.get("status") == "processing"
    )
    
    # Count active story chain tasks
    active_chain_tasks = sum(
        1 for s in STORY_CHAIN_STATUS.values() 
        if s.get("status") in ["processing", "merging"]
    )
    
    # Total active tasks
    total_active_tasks = video_processing + active_fission_tasks + active_chain_tasks
    
    return {
        "online_users": online_users,
        "online_count": len(online_users),
        "queue_stats": {
            "video_processing": video_processing,
            "video_pending": video_pending,
            "fission_active": active_fission_tasks,
            "chain_active": active_chain_tasks,
            "total_active": total_active_tasks,
            **queue_stats
        },
        "recent_activities": activities_list,
        "timestamp": datetime.now().isoformat()
    }


@app.delete("/api/v1/admin/activities")
async def clear_activities(
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Clear all activity logs (admin only)."""
    try:
        count = db.query(UserActivity).delete()
        db.commit()
        return {"status": "success", "deleted_count": count}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to clear activities: {str(e)}")


@app.get("/api/v1/admin/user/{user_id}/tasks")
async def get_user_tasks_admin(
    user_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Get all tasks for a specific user (admin only)."""
    # Get tasks from Redis queue
    try:
        task_queue = await get_task_queue()
        redis_tasks = await task_queue.get_user_tasks(user_id)
    except Exception:
        redis_tasks = []
    
    # Get video queue items from database
    video_tasks = db.query(VideoQueueItem).filter(
        VideoQueueItem.user_id == user_id
    ).order_by(VideoQueueItem.created_at.desc()).limit(50).all()
    
    return {
        "user_id": user_id,
        "redis_tasks": redis_tasks,
        "video_tasks": [
            {
                "id": v.id,
                "filename": v.filename,
                "status": v.status,
                "created_at": v.created_at.isoformat() if v.created_at else None
            }
            for v in video_tasks
        ]
    }


@app.get("/api/v1/admin/activities")
async def get_all_activities(
    limit: int = 50,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Get all recent activities across all users."""
    activities = db.query(UserActivity).order_by(
        UserActivity.created_at.desc()
    ).limit(limit).all()
    
    # Enrich with user info
    user_ids = set(a.user_id for a in activities if a.user_id)
    users = db.query(User).filter(User.id.in_(user_ids)).all()
    user_map = {u.id: u.username for u in users}
    
    return [
        {
            "id": a.id,
            "user_id": a.user_id,
            "username": user_map.get(a.user_id, "Unknown"),
            "action": a.action,
            "details": a.details,
            "created_at": a.created_at.isoformat() if a.created_at else None
        }
        for a in activities
    ]


# Helper function to log user activity
async def log_user_activity(
    db: Session,
    user_id: int,
    action: str,
    details: str = None
):
    """Log a user activity for monitoring."""
    activity = UserActivity(
        user_id=user_id,
        action=action,
        details=details
    )
    db.add(activity)
    db.commit()
    
    # Also notify admins via WebSocket
    await connection_manager.broadcast_to_admins({
        "type": "user_activity",
        "data": {
            "user_id": user_id,
            "action": action,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
    })
