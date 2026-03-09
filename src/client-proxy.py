#!/usr/bin/env python3
import sys
import os
import json
import requests
import argparse

# ---------------------------------------------------------
# Configuration: Point to the Host IP and Port
# Defaults to standard Docker bridge IP or localhost fallback
# ---------------------------------------------------------
GATEWAY_URL = os.environ.get("OBSIDIAN_GATEWAY_URL", "http://172.17.0.1:8888").rstrip('/')
API_KEY = os.environ.get("OBSIDIAN_GATEWAY_KEY", "change-me-in-env")

def main():
    if len(sys.argv) < 2:
        print("Usage: obsidian <vault_arg> <command> [params]")
        sys.exit(1)

    # Simplified parsing logic: supports vault="Name" format
    vault = None
    args = sys.argv[1:]
    
    if args and args[0].startswith("vault="):
        vault = args[0].split("=")[1].strip('"').strip("'")
        args = args[1:]

    if not args:
        print("Error: Missing command")
        sys.exit(1)

    command = args[0]
    params = args[1:]

    payload = {"vault": vault}
    headers = {"X-API-Key": API_KEY}

    if command == "eval":
        # Parsing code='...'
        code_param = " ".join(params)
        if "code=" in code_param:
            code = code_param.split("code=")[1].strip().strip("'").strip('"')
            payload["code"] = code
        else:
            payload["code"] = code_param
        endpoint = "/eval"
    elif command == "search":
        # Parsing query="..." limit=...
        query_param = " ".join(params)
        if "query=" in query_param:
            query = query_param.split("query=")[1].split("limit=")[0].strip().strip('"')
            payload["query"] = query
        else:
            payload["query"] = query_param
            
        if "limit=" in query_param:
            limit = query_param.split("limit=")[1].strip()
            payload["limit"] = int(limit)
        endpoint = "/search"
    elif command == "graph":
        # Parsing central_node="..." depth=...
        query_param = " ".join(params)
        if "central_node=" in query_param:
            node = query_param.split("central_node=")[1].split("depth=")[0].strip().strip('"')
            payload["central_node"] = node
        else:
            payload["central_node"] = query_param
            
        if "depth=" in query_param:
            depth = query_param.split("depth=")[1].strip()
            payload["depth"] = int(depth)
        endpoint = "/graph"
    else:
        # Fallback for other standard Obsidian CLI commands
        payload["command"] = command
        payload["args"] = params
        endpoint = "/cmd"

    try:
        response = requests.post(f"{GATEWAY_URL}{endpoint}", json=payload, headers=headers)
        response.raise_for_status()
        result = response.json()
        
        if result.get("status") == "success":
            output = result.get("output", "")
            if isinstance(output, (dict, list)):
                print(json.dumps(output, indent=2, ensure_ascii=False))
            else:
                print(output)
        else:
            print(f"Error: {result.get('error')}")
            if "stderr" in result:
                print(f"Stderr: {result['stderr']}")
            sys.exit(1)
            
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 401:
            print(f"Error: Authentication failed. Please check your OBSIDIAN_GATEWAY_KEY.")
        else:
            print(f"HTTP Error from Gateway: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Failed to connect to Obsidian Gateway at {GATEWAY_URL}: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
