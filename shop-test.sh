#!/bin/bash
# Quick shop test wrapper

echo "🛒 CakraNode Auto Shop Quick Test"
echo "=================================="
echo ""

if [ $# -eq 0 ]; then
    echo "Usage: ./shop-test.sh [category] [item] [quantity] [--debug]"
    echo ""
    echo "Examples:"
    echo "  ./shop-test.sh shard \"skeleton spawner\" 1"
    echo "  ./shop-test.sh blocks stone 64"
    echo "  ./shop-test.sh food \"golden apple\" 10 --debug"
    echo ""
    echo "Running with defaults (shard, skeleton spawner, 1)..."
    node src/test-auto-shop.js
else
    echo "Category: $1"
    echo "Item: $2"
    echo "Quantity: ${3:-1}"
    echo ""
    node src/test-auto-shop.js "$@"
fi
