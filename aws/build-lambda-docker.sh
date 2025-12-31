#!/bin/bash
# Build Lambda deployment package using Docker (ensures Linux wheels)

set -e

echo "Building Lambda deployment package with Docker (Linux wheels)..."

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Docker image name
IMAGE_NAME="diamonddrip-lambda-builder:latest"

# Build the Docker image
echo "Building Docker image..."
docker build -t "$IMAGE_NAME" .

# Create a temporary container to extract the package
echo "Creating temporary container..."
CONTAINER_ID=$(docker create "$IMAGE_NAME")

# Extract the lambda package from the container
echo "Extracting lambda-package.zip from container..."
docker cp "$CONTAINER_ID:/build/lambda-package.zip" "./lambda-package-docker.zip"

# Remove the temporary container
echo "Cleaning up temporary container..."
docker rm "$CONTAINER_ID"

# Check if the file was created
if [ -f "lambda-package-docker.zip" ]; then
    FILE_SIZE=$(du -h lambda-package-docker.zip | cut -f1)
    echo ""
    echo "✓ Lambda package created successfully: lambda-package-docker.zip"
    echo "  Package size: $FILE_SIZE"
    echo ""
    echo "This package contains Linux wheels and is ready for AWS Lambda deployment."
else
    echo "ERROR: Failed to create lambda-package-docker.zip"
    exit 1
fi

