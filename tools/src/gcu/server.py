#!/usr/bin/env python3
"""
GCU Tools MCP Server

Exposes GCU (General Computing Unit) tools via Model Context Protocol.

Usage:
    # Run with STDIO transport (for agent integration)
    python -m gcu.server --stdio

    # Run with HTTP transport
    python -m gcu.server --port 4002

    # Specify capabilities
    python -m gcu.server --stdio --capabilities browser

Environment Variables:
    GCU_PORT - Server port for HTTP mode (default: 4002)
"""

from __future__ import annotations

import argparse
import asyncio
import atexit
import logging
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)


def setup_logger() -> None:
    """Configure logger for GCU server."""
    if not logger.handlers:
        stream = sys.stderr if "--stdio" in sys.argv else sys.stdout
        handler = logging.StreamHandler(stream)
        formatter = logging.Formatter("[GCU] %(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)


setup_logger()

# Suppress FastMCP banner in STDIO mode
if "--stdio" in sys.argv:
    import rich.console

    _original_console_init = rich.console.Console.__init__

    def _patched_console_init(self, *args, **kwargs):
        kwargs["file"] = sys.stderr
        _original_console_init(self, *args, **kwargs)

    rich.console.Console.__init__ = _patched_console_init

from fastmcp import FastMCP  # noqa: E402

from gcu import register_gcu_tools  # noqa: E402

# ---------------------------------------------------------------------------
# Shutdown hooks — kill Chrome processes when the server exits
# ---------------------------------------------------------------------------


async def _bridge_rebind_supervisor(bridge, port: int) -> None:
    """Retry binding the bridge port until it succeeds.

    bridge.start() logs and swallows OSError when the port is held by
    another process (a stale runtime, an old Electron instance, etc.).
    Without retry the bridge stays dead until the user restarts the
    runtime — so the desktop app appears to "support hot install" but
    really doesn't. This loop polls every 5s and re-attempts start()
    whenever the underlying server is missing; once the conflicting
    holder exits the bridge comes up automatically.
    """
    while True:
        await asyncio.sleep(5.0)
        # ``_server`` is None either because start() never succeeded or
        # because stop() ran (in which case the supervisor was cancelled
        # and we won't reach here). Either way: try again.
        if getattr(bridge, "_server", None) is None:
            try:
                await bridge.start(port=port)
            except Exception as e:
                logger.debug("Bridge rebind attempt failed: %s", e)


@asynccontextmanager
async def _lifespan(server: FastMCP) -> AsyncIterator[dict]:
    """FastMCP lifespan hook: start the Beeline bridge, clean up on shutdown."""
    from gcu.browser.bridge import init_bridge

    bridge = init_bridge()
    bridge_port = int(os.getenv("HIVE_BRIDGE_PORT", "9229"))
    await bridge.start(port=bridge_port)
    rebind_task = asyncio.create_task(_bridge_rebind_supervisor(bridge, bridge_port))

    yield {}

    from gcu.browser.session import shutdown_all_browsers

    logger.info("Server shutting down, cleaning up browser sessions...")
    rebind_task.cancel()
    try:
        await rebind_task
    except (asyncio.CancelledError, Exception):
        pass
    await shutdown_all_browsers()
    await bridge.stop()


def _sync_shutdown() -> None:
    """atexit fallback: run async browser cleanup from sync context.

    Covers SIGTERM and other exits where the lifespan teardown may not run.
    """
    from gcu.browser.session import shutdown_all_browsers

    try:
        asyncio.run(shutdown_all_browsers())
    except Exception:
        pass


atexit.register(_sync_shutdown)

mcp = FastMCP("gcu-tools", lifespan=_lifespan)


def main() -> None:
    """Entry point for the GCU MCP server."""
    parser = argparse.ArgumentParser(description="GCU Tools MCP Server")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("GCU_PORT", "4002")),
        help="HTTP server port (default: 4002)",
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="HTTP server host (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--stdio",
        action="store_true",
        help="Use STDIO transport instead of HTTP",
    )
    parser.add_argument(
        "--capabilities",
        nargs="+",
        default=["browser"],
        help="GCU capabilities to enable (default: browser)",
    )
    args = parser.parse_args()

    # Register GCU tools
    tools = register_gcu_tools(mcp, capabilities=args.capabilities)

    if not args.stdio:
        logger.info(f"Registered {len(tools)} GCU tools: {tools}")

    if args.stdio:
        mcp.run(transport="stdio")
    else:
        logger.info(f"Starting GCU server on {args.host}:{args.port}")
        # FastMCP.run() forwards kwargs to anyio.run() instead of the
        # transport, which breaks host/port for SSE. Invoke run_async
        # directly so the kwargs land on run_sse_async.
        asyncio.run(mcp.run_async(transport="sse", host=args.host, port=args.port))


if __name__ == "__main__":
    main()
