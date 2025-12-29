#!/bin/bash
# Build Lambda deployment package

set -e

echo "Building Lambda deployment package..."

# Create temporary directory
TEMP_DIR=$(mktemp -d)
echo "Using temp directory: $TEMP_DIR"

# Copy Lambda function files
cp lambda_function.py "$TEMP_DIR/"
cp database.py "$TEMP_DIR/"

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt -t "$TEMP_DIR/" --quiet

# Create zip file
echo "Creating zip package..."
cd "$TEMP_DIR"
zip -r ../../lambda-package.zip . -q
cd - > /dev/null

# Cleanup
rm -rf "$TEMP_DIR"

echo "Lambda package created: lambda-package.zip"
echo "Package size: $(du -h lambda-package.zip | cut -f1)"


