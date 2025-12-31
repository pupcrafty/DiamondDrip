# Dockerfile for building DiamondDrip Lambda deployment package
# Note: Build context should be the project root (parent of aws/)
# Example: docker build -f aws/Dockerfile -t lambda-builder .
FROM python:3.12-slim

# Set working directory
WORKDIR /build

# Copy Lambda function files from aws/
COPY aws/lambda_function.py .
COPY aws/database.py .
COPY aws/requirements.txt .

# Copy prediction engine files from synchronizer/
COPY synchronizer/prediction_engine.py .
COPY synchronizer/prediction_api.py .
COPY synchronizer/slot_prior_model.py .

# Install dependencies (requirements.txt was copied to /build root)
RUN pip install --no-cache-dir -r /build/requirements.txt -t /build

# Create zip package
RUN apt-get update && apt-get install -y zip && \
    zip -r lambda-package.zip . && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Default command: show package info
CMD ["sh", "-c", "ls -lh lambda-package.zip && echo 'Build complete. Package ready at: lambda-package.zip'"]


