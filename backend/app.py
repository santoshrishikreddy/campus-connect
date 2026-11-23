"""Campus Connect API backed by Supabase/PostgreSQL."""

import os
from functools import lru_cache
from typing import Annotated
from uuid import UUID

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from postgrest import APIError
from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions

load_dotenv()
app = FastAPI(title="Campus Connect API", version="1.0.0")
cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "https://campus-connect-frontend-lemon.vercel.app,http://localhost:5173",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@lru_cache(maxsize=1)
def config() -> tuple[str, str]:
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        raise HTTPException(status_code=503, detail="Supabase is not configured.")
    return url, key


def supabase(access_token: str | None = None) -> Client:
    url, key = config()
    headers = {"Authorization": f"Bearer {access_token}"} if access_token else {}
    return create_client(url, key, SyncClientOptions(headers=headers))


def current_user(authorization: Annotated[str | None, Header()] = None) -> tuple[UUID, str]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="A valid bearer token is required.")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="A valid bearer token is required.")
    try:
        user = supabase().auth.get_user(token).user
        if user is None:
            raise ValueError("Missing user")
        return UUID(user.id), token
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired session.") from exc


class EventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    capacity: int | None = Field(default=None, ge=0)
    status: str | None = None


class EventUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    capacity: int | None = Field(default=None, ge=0)
    status: str | None = None


class RegistrationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: UUID


def db_error(exc: APIError) -> HTTPException:
    code = getattr(exc, "code", None)
    if code == "23505":
        return HTTPException(status_code=409, detail="You are already registered for this event.")
    if code == "P0001":
        message = (getattr(exc, "message", "") or "").lower()
        if "full" in message:
            return HTTPException(status_code=409, detail="This event is full.")
        if "duplicate" in message or "already" in message:
            return HTTPException(status_code=409, detail="You are already registered for this event.")
        if "not found" in message:
            return HTTPException(status_code=404, detail="Event not found.")
        return HTTPException(status_code=400, detail="Registration could not be completed.")
    if code in {"23503", "23502", "22P02", "23514"}:
        return HTTPException(status_code=400, detail="Invalid database request.")
    return HTTPException(status_code=502, detail="Database request failed.")


@app.get("/")
def index():
    return {"name": "Campus Connect API", "docs": "/docs", "endpoints": ["/api/events", "/api/registrations"]}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/events")
def list_events():
    try:
        return {"data": supabase().table("events").select("*").execute().data}
    except APIError as exc:
        raise db_error(exc) from exc


@app.get("/api/events/{event_id}")
def get_event(event_id: UUID):
    try:
        result = supabase().table("events").select("*").eq("id", str(event_id)).maybe_single().execute()
        if result.data is None:
            raise HTTPException(status_code=404, detail="Event not found.")
        return {"data": result.data}
    except APIError as exc:
        raise db_error(exc) from exc


@app.post("/api/events", status_code=status.HTTP_201_CREATED)
def create_event(body: EventCreate, identity: tuple[UUID, str] = Depends(current_user)):
    user_id, token = identity
    try:
        result = supabase(token).table("events").insert({**body.model_dump(), "organizer_id": str(user_id)}).execute()
        return {"data": result.data[0] if result.data else None}
    except APIError as exc:
        raise db_error(exc) from exc


@app.patch("/api/events/{event_id}")
def update_event(event_id: UUID, body: EventUpdate, identity: tuple[UUID, str] = Depends(current_user)):
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(status_code=400, detail="Provide at least one field to update.")
    user_id, token = identity
    try:
        result = supabase(token).table("events").update(patch).eq("id", str(event_id)).eq("organizer_id", str(user_id)).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Event not found.")
        return {"data": result.data[0]}
    except APIError as exc:
        raise db_error(exc) from exc


@app.delete("/api/events/{event_id}")
def delete_event(event_id: UUID, identity: tuple[UUID, str] = Depends(current_user)):
    user_id, token = identity
    try:
        result = supabase(token).table("events").delete().eq("id", str(event_id)).eq("organizer_id", str(user_id)).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Event not found.")
        return {"data": result.data[0]}
    except APIError as exc:
        raise db_error(exc) from exc


@app.get("/api/registrations")
def list_registrations(identity: tuple[UUID, str] = Depends(current_user)):
    user_id, token = identity
    try:
        rows = supabase(token).table("registrations").select("*").eq("user_id", str(user_id)).execute().data
        return {"data": rows}
    except APIError as exc:
        raise db_error(exc) from exc


@app.post("/api/registrations", status_code=status.HTTP_201_CREATED)
def register(body: RegistrationCreate, identity: tuple[UUID, str] = Depends(current_user)):
    user_id, token = identity
    try:
        result = supabase(token).rpc("register_for_event", {"p_event_id": str(body.event_id)}).execute()
        return {"data": result.data}
    except APIError as exc:
        raise db_error(exc) from exc


@app.delete("/api/registrations/{registration_id}")
def unregister(registration_id: UUID, identity: tuple[UUID, str] = Depends(current_user)):
    user_id, token = identity
    try:
        result = supabase(token).table("registrations").delete().eq("id", str(registration_id)).eq("user_id", str(user_id)).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Registration not found.")
        return {"data": result.data[0]}
    except APIError as exc:
        raise db_error(exc) from exc


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=False)
