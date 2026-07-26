import asyncio
import json
import websockets
import urllib.request

async def test_websocket():
    uri = "ws://127.0.0.1:8000/ws/telemetry"
    print("\n--- [1] Testing WebSocket Stream (/ws/telemetry) ---")
    async with websockets.connect(uri) as ws:
        for i in range(3):
            msg = await ws.recv()
            data = json.loads(msg)
            fleet = data.get("fleet_summary", {})
            nodes = data.get("nodes", {})
            print(f"Frame #{i+1}: Active Nodes = {fleet.get('active_nodes')}/4 | Queue = {len(data.get('queue', []))} | Node 01 Status = {nodes.get('node-01', {}).get('status')} ({nodes.get('node-01', {}).get('progress')}%)")
            await asyncio.sleep(0.5)

def test_rest_api():
    print("\n--- [2] Testing REST Endpoints ---")
    req = urllib.request.urlopen("http://127.0.0.1:8000/api/telemetry")
    data = json.loads(req.read().decode())
    print(f"GET /api/telemetry: Status 200 OK | Total Nodes = {len(data['nodes'])}")
    
    # Test Demo CAD Upload
    post_data = json.dumps({"filename": "Aero_Bracket_V2.3mf", "file_size_kb": 6400}).encode('utf-8')
    req2 = urllib.request.Request("http://127.0.0.1:8000/api/demo-upload", data=post_data, headers={'Content-Type': 'application/json'})
    res2 = urllib.request.urlopen(req2)
    job_res = json.loads(res2.read().decode())
    print(f"POST /api/demo-upload: Job Queued & Auto-Routed -> {job_res['job']['job_id']} ({job_res['job']['filename']}) to {job_res['job']['auto_routed_node']}")

async def main():
    test_rest_api()
    await test_websocket()
    print("\n✅ ALL BACKEND & WEBSOCKET VERIFICATION TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    asyncio.run(main())
