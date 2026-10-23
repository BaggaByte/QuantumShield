from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    app_name: str = "QuantumShield"
    app_version: str = "1.0.0"
    debug: bool = False
    host: str = "0.0.0.0"
    port: int = 8000
    allowed_origins: List[str] = ["http://localhost:5173", "http://localhost:4173", "http://127.0.0.1:5173"]
    max_rooms: int = 100
    max_participants_per_room: int = 2
    max_message_size_bytes: int = 65536
    room_ttl_seconds: int = 3600
    
    class Config:
        env_file = ".env"

settings = Settings()
