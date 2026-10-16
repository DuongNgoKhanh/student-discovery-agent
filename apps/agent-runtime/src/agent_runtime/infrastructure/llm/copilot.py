import time
from dataclasses import dataclass, field
from os import getenv
from typing import Any, Dict, Optional

import httpx
from agno.exceptions import ModelAuthenticationError
from agno.models.openai.like import OpenAILike

from agent_runtime.infrastructure.http.logging import logger

# Headers required by the GitHub Copilot API
_COPILOT_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
    "Content-Type": "application/json",
}


@dataclass
class CopilotChat(OpenAILike):
    """
    A class for interacting with GitHub Copilot models via the Copilot API.

    The provider automatically exchanges GitHub credentials for a short-lived
    user access token, caching and refreshing it as needed using OAuth flow.

    Attributes:
        id: The model id to use. Default is "gpt-4.1".
        name: Display name for the model. Default is "CopilotChat".
        provider: Provider identifier. Default is "Copilot".
        github_token: A GitHub personal access token with Copilot access.
            Falls back to GITHUB_COPILOT_TOKEN environment variable.
        client_id: GitHub App client ID for OAuth refresh.
            Falls back to GITHUB_CLIENT_ID environment variable.
        client_secret: GitHub App client secret for OAuth refresh.
            Falls back to GITHUB_CLIENT_SECRET environment variable.
        base_url: The Copilot API endpoint.
    """

    id: str = "gpt-4.1"
    name: str = "CopilotChat"
    provider: str = "Copilot"

    # GitHub OAuth credentials
    github_token: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    base_url: str = "https://models.github.ai/inference/"

    # Internal token state — not user-facing.
    _access_token: str = field(default="", init=False, repr=False)
    _refresh_token: str = field(default="", init=False, repr=False)
    _access_token_expires_at: float = field(default=0.0, init=False, repr=False)

    def _resolve_github_credentials(self) -> tuple[str, Optional[str], Optional[str]]:
        """Resolve GitHub token, client_id, and client_secret from env or attributes.
        Returns:
            Tuple of (github_token, client_id, client_secret).
            client_id and client_secret are optional; if not provided, github_token is used directly.
        """
        token = self.github_token or getenv("GITHUB_COPILOT_TOKEN")
        client_id = self.client_id or getenv("GITHUB_CLIENT_ID")
        client_secret = self.client_secret or getenv("GITHUB_CLIENT_SECRET")

        if not token:
            logger.error("[COPILOT] GitHub token not provided in attributes or GITHUB_COPILOT_TOKEN env")
            raise ModelAuthenticationError(
                message=("GitHub token not provided. Set github_token on CopilotChat or GITHUB_COPILOT_TOKEN environment variable."),
                model_name=self.name,
            )

        masked_token = f"{token[:10]}...{token[-5:]}" if len(token) > 15 else token
        logger.debug(f"[COPILOT] Resolved credentials - token: {masked_token}, has_client_id: {bool(client_id)}, has_client_secret: {bool(client_secret)}")

        self.github_token = token
        if client_id:
            self.client_id = client_id
        if client_secret:
            self.client_secret = client_secret
        return token, client_id, client_secret

    def _refresh_access_token(self) -> str:
        """Refresh the access token using OAuth refresh token flow or direct token.

        If OAuth credentials (client_id/client_secret) are available, uses OAuth refresh token flow.
        Otherwise, uses the github_token directly as the access token.
        The token is cached and only refreshed when it expires (with a 60-second buffer).
        """
        now = time.time()
        if self._access_token and now < (self._access_token_expires_at - 60):
            logger.debug(f"[COPILOT] Using cached access token (expires in {int(self._access_token_expires_at - now)}s)")
            return self._access_token

        github_token, client_id, client_secret = self._resolve_github_credentials()

        # If OAuth credentials are available, use OAuth refresh token flow
        if client_id and client_secret:
            logger.info("[COPILOT] Refreshing GitHub access token via OAuth")

            # If we don't have a refresh token yet, use the initial token
            refresh_token = self._refresh_token or github_token

            masked_refresh = f"{refresh_token[:10]}...{refresh_token[-5:]}" if len(refresh_token) > 15 else refresh_token
            logger.debug(f"[COPILOT] OAuth POST https://github.com/login/oauth/access_token with refresh_token={masked_refresh}")

            response = httpx.post(
                "https://github.com/login/oauth/access_token",
                params={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                },
                headers={**_COPILOT_HEADERS},
                timeout=10,
            )

            if response.status_code != 200:
                logger.error(f"[COPILOT] OAuth token refresh failed: {response.status_code} - {response.text}")
                raise ModelAuthenticationError(
                    message=(f"Failed to refresh access token: {response.status_code} - {response.text}"),
                    model_name=self.name,
                )

            payload = response.json()
            self._access_token = payload.get("access_token", "")
            self._refresh_token = payload.get("refresh_token", "")
            expires_in = payload.get("expires_in", 28800)  # Default 8 hours
            self._access_token_expires_at = now + expires_in

            masked_token = f"{self._access_token[:10]}...{self._access_token[-5:]}" if len(self._access_token) > 15 else self._access_token
            logger.info(f"[COPILOT] OAuth token refreshed successfully: {masked_token} (expires in {expires_in}s)")

            if not self._access_token:
                logger.error("[COPILOT] Token response did not contain an access_token")
                raise ModelAuthenticationError(
                    message="Token response did not contain an access_token.",
                    model_name=self.name,
                )
        else:
            # Fall back to using github_token directly without OAuth refresh
            logger.info("[COPILOT] Using GitHub token directly (OAuth credentials not available)")
            self._access_token = github_token
            self._access_token_expires_at = now + 28800  # Assume 8-hour validity
            masked_token = f"{github_token[:10]}...{github_token[-5:]}" if len(github_token) > 15 else github_token
            logger.debug(f"[COPILOT] Direct token: {masked_token}")

        # Log curl equivalent for debugging
        masked_token = f"{self._access_token[:10]}...{self._access_token[-5:]}" if len(self._access_token) > 15 else self._access_token
        headers_log = {k: v for k, v in self.default_headers.items()} if self.default_headers else {}
        headers_log["Authorization"] = f"Bearer {masked_token}"
        logger.info(f"[COPILOT] API endpoint: POST {self.base_url}chat/completions")
        logger.debug(f"[COPILOT] Headers: {headers_log}")
        logger.debug(f"[COPILOT] Equivalent curl: curl -X POST -H 'Authorization: Bearer {masked_token}' -H 'Accept: application/vnd.github+json' {self.base_url}chat/completions")

        return self._access_token

    def _get_client_params(self) -> Dict[str, Any]:
        """Refresh the access token via OAuth, then build client params with proper headers."""
        token = self._refresh_access_token()
        self.api_key = token

        # Merge headers: Copilot API headers + any existing default headers
        merged_headers = {**_COPILOT_HEADERS}
        if self.default_headers:
            merged_headers.update(self.default_headers)
        self.default_headers = merged_headers

        return super()._get_client_params()

    def get_client(self):  # type: ignore[override]
        """Return a sync OpenAI client, refreshing the access token if needed."""
        token = self._refresh_access_token()
        # Invalidate cached client when the token has changed
        if self.client is not None and self.api_key != token:
            if not self.client.is_closed():
                self.client.close()
            self.client = None
        return super().get_client()

    def get_async_client(self):  # type: ignore[override]
        """Return an async OpenAI client, refreshing the access token if needed."""
        token = self._refresh_access_token()
        # Invalidate cached client when the token has changed
        if self.async_client is not None and self.api_key != token:
            self.async_client = None
        return super().get_async_client()
