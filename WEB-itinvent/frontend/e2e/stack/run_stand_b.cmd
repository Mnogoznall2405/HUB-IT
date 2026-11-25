@echo off
set E2E_BACKEND_PORT=18013
set E2E_STATE_NAME=.state-v3
set E2E_FRONTEND_PORT=5184
set MAIL_CREDENTIALS_KEY=gQZ2l2zH2p3K9mJ8xN4vB7cD1fG5hJ6kL8mN0pQ3rS4tU5vW6xY7zA1bC2dE3fG4hI=
set MY_FILES_SHARE_TOKEN_KEY=sH7jK2lM4nP6qR8sT0uV2wX4yZ6aB8cD0eF2gH4iJ6kL8mN0pQ2rS4tU6vW8xY0zA=
cd /d C:\Project\HUB-IT-v3-wt\WEB-itinvent\frontend
python e2e\stack\local_backend.py >> e2e\stack\stand-b.log 2>&1
