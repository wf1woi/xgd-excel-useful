import logging

from fastapi import FastAPI
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router as api_router
from app.core.bootstrap import ensure_runtime_dirs
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.core.schema_loader import ensure_schema


def create_app() -> FastAPI:
    settings = get_settings()
    ensure_runtime_dirs(settings)
    setup_logging(settings.log_dir)

    app = FastAPI(
        title="xgd-excel-useful",
        version="0.1.0",
        description="通用 Excel 解析与规则生成工具后端服务",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router, prefix="/api")

    logger = logging.getLogger(__name__)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "Unhandled application error. method=%s path=%s",
            request.method,
            request.url.path,
        )
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "message": "服务器内部错误，请查看日志文件",
                "data": None,
            },
        )

    @app.on_event("startup")
    async def on_startup() -> None:
        ensure_schema()
        logger.info("Application started. DB path: %s", settings.db_path)

    return app


app = create_app()
