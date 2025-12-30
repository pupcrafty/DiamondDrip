#!/bin/bash
echo "Starting DiamondDrip Prediction Server..."
echo ""

# Try python3 first, then python
if command -v python3 &> /dev/null; then
    python3 prediction_server.py
elif command -v python &> /dev/null; then
    python prediction_server.py
else
    echo "Python not found. Please install Python."
    exit 1
fi



