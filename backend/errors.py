"""Consistent application error types and FastAPI exception handlers."""


from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException


class AppError(Exception):
    """Base application exception with standardized HTTP status code and error code."""

    def __init__(
        self,
        message: str = "An internal error occurred",
        code: str = "INTERNAL_SERVER_ERROR",
        status_code: int = 500,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code


class UnauthorizedError(AppError):
    """Raised when authentication is required or invalid (HTTP 401)."""

    def __init__(
        self,
        message: str = "Authentication required",
        code: str = "UNAUTHORIZED",
    ) -> None:
        super().__init__(message=message, code=code, status_code=401)


class ForbiddenError(AppError):
    """Raised when access is denied or CSRF check fails (HTTP 403)."""

    def __init__(
        self,
        message: str = "Insufficient permissions",
        code: str = "FORBIDDEN",
    ) -> None:
        super().__init__(message=message, code=code, status_code=403)


class NotFoundError(AppError):
    """Raised when a requested resource is not found (HTTP 404)."""

    def __init__(
        self,
        message: str = "Resource not found",
        code: str = "NOT_FOUND",
    ) -> None:
        super().__init__(message=message, code=code, status_code=404)


class RateLimitExceededError(AppError):
    """Raised when rate limits are breached (HTTP 429)."""

    def __init__(
        self,
        message: str = "Too many requests. Please try again later.",
        code: str = "RATE_LIMIT_EXCEEDED",
    ) -> None:
        super().__init__(message=message, code=code, status_code=429)


class ValidationError(AppError):
    """Raised on invalid client input (HTTP 422)."""

    def __init__(
        self,
        message: str = "Validation failed",
        code: str = "VALIDATION_ERROR",
    ) -> None:
        super().__init__(message=message, code=code, status_code=422)


def register_error_handlers(app: FastAPI) -> None:
    """Register uniform exception handlers returning {"error": {"code", "message"}}."""

    @app.exception_handler(AppError)
    async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        error_messages = []
        for err in exc.errors():
            loc = " -> ".join(str(p) for p in err.get("loc", []))
            msg = err.get("msg", "Invalid value")
            error_messages.append(f"{loc}: {msg}" if loc else msg)
        summary = "; ".join(error_messages) if error_messages else "Request validation failed"
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "VALIDATION_ERROR", "message": summary}},
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
        code_map: dict[int, str] = {
            400: "BAD_REQUEST",
            401: "UNAUTHORIZED",
            403: "FORBIDDEN",
            404: "NOT_FOUND",
            405: "METHOD_NOT_ALLOWED",
            422: "VALIDATION_ERROR",
            429: "RATE_LIMIT_EXCEEDED",
        }
        code = code_map.get(exc.status_code, "HTTP_ERROR")
        msg = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": code, "message": msg}},
        )
