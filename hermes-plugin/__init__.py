"""Hermes plugin entrypoint for Cowtail: the `cowtail` tool and the `cowtail` platform."""

from __future__ import annotations

from .recovery import guard_reconciliation, clear_preflight
from .handlers import COWTAIL_SCHEMA, check_cowtail_available, handle_cowtail


def register(ctx) -> None:
    """Register the Cowtail tool, and the Cowtail platform where the gateway is importable."""
    ctx.register_tool(
        name="cowtail",
        toolset="cowtail",
        schema=COWTAIL_SCHEMA,
        handler=lambda args, **kwargs: handle_cowtail(args),
        check_fn=check_cowtail_available,
        emoji="🐄",
    )
    ctx.register_hook("pre_tool_call", guard_reconciliation)
    ctx.register_hook("on_session_end", clear_preflight)
    try:
        from .cowtail_platform import register_platform
    except ImportError:
        return
    register_platform(ctx)
