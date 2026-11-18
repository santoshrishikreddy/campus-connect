"""Unauthenticated JSON API for the Campus Connect Supabase database."""

import os
from functools import wraps
from uuid import UUID

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from postgrest import APIError
from supabase import Client, create_client

load_dotenv()

app = Flask(__name__)
_supabase: Client | None = None


def get_supabase() -> Client:
    """Create the Supabase client on first request, with a useful config error."""
    global _supabase
    if _supabase is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
        if not url or not key:
            raise RuntimeError(
                "Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the environment."
            )
        _supabase = create_client(url, key)
    return _supabase


def api_errors(handler):
    @wraps(handler)
    def wrapped(*args, **kwargs):
        try:
            return handler(*args, **kwargs)
        except RuntimeError as error:
            return jsonify(error=str(error)), 503
        except APIError as error:
            code = getattr(error, "code", None)
            status = 409 if code == "23505" else 400 if code in {
                "23503", "23502", "22P02", "23514"
            } else 502
            return jsonify(error="Database request failed", details=error.message), status

    return wrapped


def json_object():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return None, (jsonify(error="Request body must be a JSON object."), 400)
    return payload, None


def validate_uuid(value: str):
    try:
        UUID(value)
    except (ValueError, TypeError, AttributeError):
        return jsonify(error="id must be a valid UUID."), 400
    return None


def collection_routes(table: str, fields: set[str], required: set[str]):
    """Register list/create and item read/update/delete routes for one table."""

    @app.get(f"/api/{table}", endpoint=f"{table}_list")
    @api_errors
    def list_items():
        query = get_supabase().table(table).select("*")
        # Registrations can be filtered without requiring a separate endpoint.
        if table == "registrations":
            for key in ("user_id", "event_id"):
                value = request.args.get(key)
                if value:
                    invalid = validate_uuid(value)
                    if invalid:
                        return invalid
                    query = query.eq(key, value)
        return jsonify(data=query.execute().data), 200

    @app.post(f"/api/{table}", endpoint=f"{table}_create")
    @api_errors
    def create_item():
        payload, error = json_object()
        if error:
            return error
        unknown = set(payload) - fields
        if unknown:
            return jsonify(error="Unknown fields", fields=sorted(unknown)), 400
        missing = required - payload.keys()
        if missing:
            return jsonify(error="Missing required fields", fields=sorted(missing)), 400
        result = get_supabase().table(table).insert(payload).execute()
        return jsonify(data=result.data[0] if result.data else None), 201

    @app.get(f"/api/{table}/<item_id>", endpoint=f"{table}_get")
    @api_errors
    def get_item(item_id):
        invalid = validate_uuid(item_id)
        if invalid:
            return invalid
        result = get_supabase().table(table).select("*").eq("id", item_id).maybe_single().execute()
        if result.data is None:
            return jsonify(error=f"{table[:-1] if table.endswith('s') else table} not found."), 404
        return jsonify(data=result.data), 200

    @app.patch(f"/api/{table}/<item_id>", endpoint=f"{table}_update")
    @api_errors
    def update_item(item_id):
        invalid = validate_uuid(item_id)
        if invalid:
            return invalid
        payload, error = json_object()
        if error:
            return error
        if not payload:
            return jsonify(error="Provide at least one field to update."), 400
        unknown = set(payload) - fields
        if unknown:
            return jsonify(error="Unknown fields", fields=sorted(unknown)), 400
        result = get_supabase().table(table).update(payload).eq("id", item_id).execute()
        if not result.data:
            return jsonify(error=f"{table[:-1] if table.endswith('s') else table} not found."), 404
        return jsonify(data=result.data[0]), 200

    @app.delete(f"/api/{table}/<item_id>", endpoint=f"{table}_delete")
    @api_errors
    def delete_item(item_id):
        invalid = validate_uuid(item_id)
        if invalid:
            return invalid
        result = get_supabase().table(table).delete().eq("id", item_id).execute()
        if not result.data:
            return jsonify(error=f"{table[:-1] if table.endswith('s') else table} not found."), 404
        return jsonify(data=result.data[0]), 200


@app.get("/")
def index():
    return jsonify(
        name="Campus Connect API",
        endpoints={
            "users": "/api/users",
            "events": "/api/events",
            "registrations": "/api/registrations",
        },
    )


@app.get("/health")
def health():
    return jsonify(status="ok")


collection_routes("users", {"email", "role"}, {"email"})
collection_routes(
    "events", {"organizer_id", "title", "capacity", "status"}, {"title"}
)
collection_routes(
    "registrations", {"user_id", "event_id"}, {"user_id", "event_id"}
)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)
