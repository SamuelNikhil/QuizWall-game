# Docker Deployment Guide

## Prerequisites

- Docker installed on EC2
- docker-compose installed on EC2

## Files Needed on EC2

Upload these files to your EC2 server:

```
server/
├── .env                    # Environment variables (contains DB_PATH, GROQ_API_KEY, etc.)
├── Dockerfile
├── docker-compose.yml
├── package.json
├── package-lock.json
├── tsconfig.json
└── src/
    └── data/
        ├── QuizzWall.sqlite    # Optional - will be created if not exists
        ├── questions.json
        ├── Ai-questions.json
        └── ...
```

**Note:** The `src/data/` folder must exist on the host (even if empty). The database file will be created there automatically if it doesn't exist.

## Build & Run

Run this command from the `server/` folder:

```bash
cd server
docker-compose up -d --build
```

This will:
- Build the Docker image from the `Dockerfile`
- Run the container in detached mode
- Mount `./src/data` from host to `/app/src/data` in container (persists database)

## Useful Commands

```bash
# View logs
docker-compose logs -f

# View logs (last 100 lines)
docker-compose logs --tail=100

# Stop the container
docker-compose down

# Restart (after code changes)
docker-compose up -d --build

# Check if container is running
docker ps

# Check container health
docker inspect quizwall-server
```

## Ports

- **3000** - HTTP API
- **9000-9100** - WebRTC UDP ports

The container uses `network_mode: host`, so ports are exposed directly on the host.

## Troubleshooting

### Container won't start

Check logs:
```bash
docker-compose logs
```

### Database not persisting

Make sure `src/data/QuizzWall.sqlite` exists on the host before running. The volume mount requires the host directory to exist.

### Permission issues

If you get permission errors, ensure the `src/data` folder is readable:
```bash
chmod -R 755 src/data
```

## Updating the App

To update with new code:

1. Upload new files to EC2
2. Rebuild and restart:
```bash
docker-compose up -d --build
```

Your database (`QuizzWall.sqlite`) will remain intact since it's stored on the host, not in the container.
