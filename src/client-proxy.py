#!/usr/bin/env python3
import sys
import json
import requests
import argparse

# ---------------------------------------------------------
# 配置：指向宿主机的 IP 和端口
# 在 Docker 中，172.17.0.1 通常是宿主机 IP
# 或者在 Windows/Mac 上使用 host.docker.internal
# ---------------------------------------------------------
GATEWAY_URL = "http://172.17.0.1:8888"

def main():
    if len(sys.argv) < 2:
        print("Usage: obsidian <vault_arg> <command> [params]")
        sys.exit(1)

    # 简易解析逻辑：支持 vault="Name" 格式
    vault = None
    args = sys.argv[1:]
    
    if args[0].startswith("vault="):
        vault = args[0].split("=")[1].strip('"').strip("'")
        args = args[1:]

    command = args[0]
    params = args[1:]

    payload = {"vault": vault}

    if command == "eval":
        # 解析 code='...'
        code_param = " ".join(params)
        if "code=" in code_param:
            code = code_param.split("code=")[1].strip().strip("'").strip('"')
            payload["code"] = code
        endpoint = "/eval"
    elif command == "search":
        # 解析 query="..."
        query_param = " ".join(params)
        if "query=" in query_param:
            query = query_param.split("query=")[1].split("limit=")[0].strip().strip('"')
            payload["query"] = query
        if "limit=" in query_param:
            limit = query_param.split("limit=")[1].strip()
            payload["limit"] = limit
        endpoint = "/search"
    else:
        print(f"Error: Command '{command}' not yet supported by gateway.")
        sys.exit(1)

    try:
        response = requests.post(f"{GATEWAY_URL}{endpoint}", json=payload)
        response.raise_for_status()
        result = response.json()
        if result.get("status") == "success":
            print(result.get("output", ""))
        else:
            print(f"Error: {result.get('error')}")
    except Exception as e:
        print(f"Failed to connect to Obsidian Gateway at {GATEWAY_URL}: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
