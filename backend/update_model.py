from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import Column, String
import os

DATABASE_URL = "postgresql://banana_db:***REDACTED_DB_PASSWORD***@1Panel-postgresql-SJJE:5432/banana_db"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

class SystemConfig(Base):
    __tablename__ = "system_config"
    key = Column(String, primary_key=True)
    value = Column(String)

db = SessionLocal()
item = db.query(SystemConfig).filter(SystemConfig.key == "model_name").first()
if item:
    print(f"Updating model_name from {item.value} to gemini-3-pro-image-preview")
    item.value = "gemini-3-pro-image-preview"
    db.commit()
else:
    print("model_name key not found, creating it.")
    item = SystemConfig(key="model_name", value="gemini-3-pro-image-preview")
    db.add(item)
    db.commit()

db.close()
