from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings. Provider credentials are optional and validated by adapters when called."""

    model_config = SettingsConfigDict(env_file=".env", env_ignore_empty=True, extra="ignore")

    LOG_LEVEL: str = "INFO"

    # Gemini / embeddings
    GOOGLE_API_KEY: str = ""
    GOOGLE_CLOUD_PROJECT: str = ""
    GOOGLE_CLOUD_LOCATION: str = ""
    GOOGLE_EMBEDDING_MODEL: str = "text-embedding-004"

    # Optional outbound proxy
    PROXY_HOST: str | None = None
    PROXY_PORT: int | None = None

    @property
    def PROXY_URL(self) -> str | None:
        if not self.PROXY_HOST or not self.PROXY_PORT:
            return None
        return f"http://{self.PROXY_HOST}:{self.PROXY_PORT}"


settings = Settings()
