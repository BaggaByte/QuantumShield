from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from typing import List, Union, Optional

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "QuantumShield"
    app_version: str = "1.0.0"
    debug: bool = False
    host: str = "0.0.0.0"
    port: int = 8001
    allowed_origins: List[str] = [
        "http://localhost:5173",
        "http://localhost:4173",
        "http://127.0.0.1:5173",
        "https://quantumshield-five.vercel.app",
    ]
    allowed_origin_regex: Optional[str] = r"^https:\/\/.*\.vercel\.app$"
    max_rooms: int = 100
    max_participants_per_room: int = 8
    max_message_size_bytes: int = 65536
    room_ttl_seconds: int = 3600
    unjoined_room_ttl_seconds: int = 300
    rate_limit_rooms_per_min: int = 15
    vapid_private_pem: Optional[str] = None
    
    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_allowed_origins(cls, v: Union[str, List[str]]):
        if isinstance(v, str):
            if v.strip() == "*":
                return ["*"]
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

settings = Settings()
