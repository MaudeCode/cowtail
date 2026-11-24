"""Hermes plugin entrypoint for Cowtail operations."""

from __future__ import annotations

from .handlers import COWTAIL_SCHEMA, check_cowtail_available, handle_cowtail


def register(ctx) -> None:
    """Register the Cowtail tool with Hermes."""
    ctx.register_tool(
        name="cowtail",
        toolset="cowtail",
        schema=COWTAIL_SCHEMA,
        handler=lambda args, **kwargs: handle_cowtail(args),
        check_fn=check_cowtail_available,
        emoji="🐄",
    )
