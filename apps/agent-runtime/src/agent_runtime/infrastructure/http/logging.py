"""
Logging Utility for SDA Backend using Loguru

This module provides simple, powerful logging using loguru with OpenTelemetry integration.
Features include:

- Beautiful colorful console output by default
- Automatic log rotation and retention
- Minimal configuration needed
- Exception tracking and formatting with full traceback capture
- OpenTelemetry HTTP integration
- Global exception handler for uncaught exceptions

Usage:
    from agent_runtime.infrastructure.http.logging import logger, setup_logging

    # Setup logging (call once in main.py)
    setup_logging()

    # Use logger directly
    logger.info("Application started")
    logger.warning("Something might be wrong")
    logger.error("An error occurred")
    logger.debug("Detailed debug information")
    logger.success("Operation completed successfully")

    # For exceptions, use logger.exception() to include traceback
    try:
        risky_operation()
    except Exception:
        logger.exception("Something went wrong")
"""

import logging
import sys
import threading
import traceback

from loguru import logger as loguru_logger

# Export logger for easy import
logger = loguru_logger


class LoguruHandler(logging.Handler):
    def emit(self, record):
        from loguru import logger

        logger.opt(exception=record.exc_info).log(record.levelname, record.getMessage())


class PropagateHandler(logging.Handler):
    """PropagateHandler forwards Loguru messages into stdlib logging for OTel."""

    def emit(self, record):
        logging.getLogger(record.name).handle(record)


def _global_exception_handler(exc_type, exc_value, exc_traceback):
    """
    Global exception handler to catch uncaught exceptions and log them with full traceback.
    """
    if issubclass(exc_type, KeyboardInterrupt):
        # Don't log keyboard interrupts
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return

    # Format the full traceback
    tb_lines = traceback.format_exception(exc_type, exc_value, exc_traceback)
    tb_text = "".join(tb_lines)

    # Merge OpenTelemetry context and traceback for failure diagnostics
    context = {
        "exception_type": exc_type.__name__,
        "exception_message": str(exc_value),
        "traceback": tb_text,
    }
    # Log with full traceback - this will be sent to both console and OTel
    logger.bind(**context).critical(f"Uncaught exception in thread {threading.current_thread().name}: {exc_value}")

    # Call the default exception handler
    sys.__excepthook__(exc_type, exc_value, exc_traceback)


def setup_logging(level: str = "INFO") -> None:
    """Setup logging configuration with Loguru + OpenTelemetry.

    This implementation builds a proper Loguru -> stdlib logging bridge,
    then attaches OpenTelemetry LoggingHandler to root logger.
    """

    # Reset Loguru and attach a single console sink
    loguru_logger.remove()
    loguru_logger.add(
        sys.stderr,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        level=level,
        colorize=True,
    )
    loguru_logger.add(PropagateHandler(), level=level)

    # Setup stdlib logging to route through Loguru
    logging.basicConfig(handlers=[], level=0)
    root_logger = logging.getLogger()
    root_logger.handlers = []
    sys.excepthook = _global_exception_handler
    loguru_logger.info("Logging setup completed with fallback handler")
