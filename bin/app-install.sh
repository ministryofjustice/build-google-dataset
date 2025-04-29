#!/usr/bin/env ash

echo "Installing node dependencies..."
npm install
echo "Done."

npm run dev

# for testing locally
tail -f /dev/null
