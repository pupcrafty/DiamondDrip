# Dockerfile for building DiamondDrip Lambda deployment package
FROM python:3.11-slim

# Set working directory
WORKDIR /build

# Copy Lambda function files
COPY lambda_function.py .
COPY database.py .
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt -t .

# Create zip package
RUN apt-get update && apt-get install -y zip && \
    zip -r lambda-package.zip . && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Default command: show package info
CMD ["sh", "-c", "ls -lh lambda-package.zip && echo 'Build complete. Package ready at: lambda-package.zip'"]


