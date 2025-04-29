#!/usr/bin/env ash

echo "Installing node dependencies..."
npm install
echo "Done."

npm run dev

# for testing locally - remove this line when deploying
tail -f /dev/null
