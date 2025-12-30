# Lambda Build Instructions for DiamondDrip

This document provides instructions for building the DiamondDrip Lambda function deployment package.

## Build Process

The Lambda function is built using a bash script that:
1. Creates a temporary directory
2. Copies Lambda function files (lambda_function.py, database.py)
3. Installs Python dependencies from requirements.txt
4. Creates a zip package (lambda-package.zip)

## Build Command

```bash
bash build-lambda.sh
```

Or manually:
```bash
# Create temp directory
TEMP_DIR=$(mktemp -d)

# Copy files
cp lambda_function.py "$TEMP_DIR/"
cp database.py "$TEMP_DIR/"

# Install dependencies
pip install -r requirements.txt -t "$TEMP_DIR/"

# Create zip
cd "$TEMP_DIR"
zip -r ../../lambda-package.zip .
cd -
rm -rf "$TEMP_DIR"
```

## Docker Alternative

For Docker-based builds, you can use the following Dockerfile:

```dockerfile
FROM public.ecr.aws/lambda/python:3.11

# Copy Lambda function files
COPY lambda_function.py ${LAMBDA_TASK_ROOT}/
COPY database.py ${LAMBDA_TASK_ROOT}/

# Copy requirements and install dependencies
COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install -r requirements.txt -t ${LAMBDA_TASK_ROOT}/

# Set the CMD to your handler
CMD [ "lambda_function.lambda_handler" ]
```

## Build Context

- **Source Files**: lambda_function.py, database.py
- **Dependencies**: requirements.txt
- **Output**: lambda-package.zip

## Requirements

- Python 3.11+
- pip
- bash (for build-lambda.sh)
- zip utility

## Notes

- The build process installs all dependencies into the package
- The final package size should be checked before deployment
- Lambda has a 50MB limit for direct uploads (250MB unzipped)
- For larger packages, use S3 for deployment

