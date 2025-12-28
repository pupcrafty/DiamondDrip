#!/bin/bash
echo "Starting Microphone Info Collection Server..."
echo

# Check if Flask is installed
python3 -c "import flask" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "Flask is not installed. Installing..."
    pip3 install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo
        echo "Failed to install Flask. Please install manually:"
        echo "  pip3 install flask"
        exit 1
    fi
fi

# Start the server
python3 microphone_info_server.py

