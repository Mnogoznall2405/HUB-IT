---
name: fastapi-router-py
description: Implement FastAPI endpoints using the existing routes, auth dependencies, services and response contracts.
license: MIT
metadata:
  author: Microsoft
  version: 1.0.0
---

# FastAPI Routers

Implement the requested endpoint in the repository's existing router, dependency, service and response-model conventions. Locate a neighboring endpoint, router registration, authentication dependencies and tests before choosing paths or imports.

Preserve the route prefix, identifiers, response fields, status codes and authorization contract unless their change is requested. Required authentication remains required; optional authentication is appropriate only for a deliberately public endpoint. Check resource-level permissions as well as login.

Use the existing service/store lifecycle and sync/async patterns. Do not add a new directory structure, ORM or generic CRUD layer merely to fit this skill. In HUB-IT, inspect `WEB-itinvent/backend/api/deps.py`: `get_current_user` is required auth and `get_current_user_optional` is optional; verify their current definitions before use.

The [router template](assets/template.py) is an optional scaffold for a new resource. Its import paths, dependencies, prefix and model/service names are placeholders, not repository facts. Adapt them only after checking the actual application. Prefer extending a neighboring router when that is clearer.

Verify the changed route's successful response, relevant authorization failures and input errors with focused tests. Production deployment and database mutations remain subject to the user's existing authorization boundaries.
