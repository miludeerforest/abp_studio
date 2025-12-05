from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import Column, String
import os

DATABASE_URL = "postgresql://banana_db:S7pGzXX2JmaH38yX@1Panel-postgresql-SJJE:5432/banana_db"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

class SystemConfig(Base):
    __tablename__ = "system_config"
    key = Column(String, primary_key=True)
    value = Column(String)

db = SessionLocal()
item = db.query(SystemConfig).filter(SystemConfig.key == "api_url").first()
if item and item.value == "https://one.codeedu.de":
    print("Updating API URL to include /v1")
    item.value = "https://one.codeedu.de/v1"
    db.commit()
else:
    print(f"Current value: {item.value if item else 'None'}")
db.close()
