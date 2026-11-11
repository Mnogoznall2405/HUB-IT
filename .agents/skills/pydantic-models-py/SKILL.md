---
name: pydantic-models-py
description: Create or update Pydantic schemas while preserving the existing API and persistence contracts.
license: MIT
metadata:
  author: Microsoft
  version: 1.0.0
---

# Pydantic Models

Inspect adjacent schemas and the installed Pydantic version. Add only the request, response or storage model the feature needs in the existing model location.

Preserve field names, aliases, identifier types, nullability, defaults and serialization behavior unless the public contract is explicitly changing. Distinguish an omitted update field from an explicit null using the project's update semantics. Do not impose camelCase aliases, an InDB model, a document discriminator or a five-model hierarchy on every resource.

The [model template](assets/template.py) illustrates one multi-model document-store design. Use only compatible parts when that design is actually requested; it is not the default for SQL or an existing API. Match the current service/store and frontend contract rather than introducing the template's paths or persistence fields.

Verify the affected parsing, validation and serialized API behavior with representative input. Keep production schema changes separate from local schema-class edits.
