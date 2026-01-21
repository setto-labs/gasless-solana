#!/bin/bash

cd "$(dirname "$0")/../.."

echo ""
echo "========================================"
echo "    Sync to Public Repository"
echo "========================================"
echo ""

# Configuration
PUBLIC_REPO_URL="git@github-settopay:settopay-cripto/setto-pay-solana.git"
PUBLIC_REPO_DIR="/tmp/setto-solana-programs"

# Files to sync
FILES_TO_SYNC=(
    "src/"
    "Cargo.toml"
    "Cargo.lock"
    "Anchor.toml"
)

# Clone or update public repo
if [ -d "$PUBLIC_REPO_DIR" ]; then
    echo "Updating existing clone..."
    cd "$PUBLIC_REPO_DIR"
    git fetch origin
    git reset --hard origin/main
    cd - > /dev/null
else
    echo "Cloning public repository..."
    git clone "$PUBLIC_REPO_URL" "$PUBLIC_REPO_DIR"
fi

if [ $? -ne 0 ]; then
    echo "Error: Failed to clone/update repository"
    exit 1
fi

# Clean existing files in public repo (except .git)
echo ""
echo "Cleaning public repo..."
find "$PUBLIC_REPO_DIR" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

# Copy files
echo "Copying files..."
for item in "${FILES_TO_SYNC[@]}"; do
    if [ -e "$item" ]; then
        cp -r "$item" "$PUBLIC_REPO_DIR/"
        echo "  Copied: $item"
    else
        echo "  Warning: $item not found"
    fi
done

# Show status
echo ""
echo "========================================"
echo "    Changes to commit"
echo "========================================"
cd "$PUBLIC_REPO_DIR"
git status --short

# Check if there are changes
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
    echo ""
    echo "No changes to commit."
    exit 0
fi

# Get commit message
echo ""
read -p "Enter commit message (or 'q' to cancel): " commit_msg

if [ "$commit_msg" = "q" ] || [ -z "$commit_msg" ]; then
    echo "Cancelled."
    exit 0
fi

# Commit and push
echo ""
echo "Committing changes..."
git add -A
git commit -m "$commit_msg"

if [ $? -ne 0 ]; then
    echo "Error: Commit failed"
    exit 1
fi

echo ""
read -p "Push to origin/main? [y/N]: " do_push

if [ "$do_push" = "y" ] || [ "$do_push" = "Y" ]; then
    git push origin main

    if [ $? -eq 0 ]; then
        echo ""
        echo "========================================"
        echo "    Sync Complete!"
        echo "========================================"
        echo ""
        echo "Repository: $PUBLIC_REPO_URL"
        echo "Commit: $(git rev-parse HEAD)"
        echo ""
        echo "You can now run './scripts/run/register-verify.sh'"
        echo "to register the verified build on Solscan."
    else
        echo "Error: Push failed"
        exit 1
    fi
else
    echo ""
    echo "Changes committed locally but not pushed."
    echo "Run 'cd $PUBLIC_REPO_DIR && git push origin main' to push."
fi
echo ""
