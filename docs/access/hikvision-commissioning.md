# Hikvision DS-K2602T & DS-K1108AMK Commissioning Runbook

## 1. Initial Bench Setup & Addressing

1. **Power Up Controller**:
   - Connect 12V DC power supply to DS-K2602T.
   - Connect Ethernet port to isolated Access VLAN switch.
2. **Reader Wiring & DIP Switches**:
   - **Reader 1 (Entry)**: RS-485 Terminal 1 (`D+`, `D-`, `+12V`, `GND`). Set DIP address to `1` (`10000000`).
   - **Reader 2 (Exit)**: RS-485 Terminal 2 (`D+`, `D-`, `+12V`, `GND`). Set DIP address to `2` (`01000000`).
3. **Turnstile Relay Wiring**:
   - **Relay 1**: Connect `COM1` and `NO1` on DS-K2602T to `K1` and `GND` on ZKTeco TS1000 Pro.
   - **Relay 2**: Connect `COM2` and `NO2` on DS-K2602T to `K2` and `GND` on ZKTeco TS1000 Pro.

---

## 2. Controller Network & Password Activation

1. Use Hikvision SADP tool or web interface to activate the device with a strong dedicated password (16+ chars).
2. Assign static IP: `192.168.30.20`, subnet `255.255.255.0`, gateway `192.168.30.1` (or null if isolated).
3. Disable all unneeded cloud services (Hik-Connect, UPnP, Bonjour, EZVIZ).
4. Verify ISAPI is enabled with Digest Authentication.

---

## 3. Credential Format Calibration (PHY-007)

1. Open Gateway diagnostic stream listener or SADP event log.
2. Present physical test card (MIFARE 1K UID known: e.g. `04A1B2C3D4E5F6`).
3. Record the exact XML `<cardNo>` value emitted by `<AccessControllerEvent>`.
4. Determine whether controller output is:
   - Hexadecimal MSB (e.g. `04A1B2C3D4E5F6`)
   - Hexadecimal LSB (e.g. `F6E5D4C3B2A104`)
   - 8-digit Decimal / 10-digit Decimal
5. Configure card enrollment format in GymFlow Cloud to match this canonical representation.

---

## 4. Gateway Configuration File Template

```json
{
  "gatewayId": "gw-gym-turnstile-01",
  "branchId": "11111111-1111-4111-8111-111111111111",
  "controllerHost": "192.168.30.20",
  "controllerPort": 80,
  "useHttps": false,
  "username": "gymflow_api",
  "defaultDoorNo": 1,
  "defaultReaderNo": 1,
  "dedupWindowMs": 1500,
  "readerMappings": {
    "1": {
      "accessPointId": "point-entry-main",
      "direction": "entry",
      "doorNo": 1
    },
    "2": {
      "accessPointId": "point-exit-main",
      "direction": "exit",
      "doorNo": 2
    }
  }
}
```

---

## 5. Operational Incident Response

| Incident Scenario | Root Cause / Detection | Operational Procedure |
| :--- | :--- | :--- |
| **Gateway Appliance Stolen** | Physical break-in / tamper alert | Revoke Gateway via authoritative GymFlow administrative API or console (`PATCH /api/access/gateways/:id` with `status: 'revoked'`); re-enroll replacement hardware with fresh machine key pair. Note: offline gateways continue local enforcement until snapshot `validUntil` expires. Never perform direct manual SQL updates. |
| **Controller Password Compromised** | Unauthorized access to network | Reset controller via physical tamper button; assign fresh 24-char secret; update Gateway secret store. |
| **Badge Cloned / Lost** | Member report / anomalous access | Mark credential `lost` or `revoked` in GymFlow Cloud; sync propagates new snapshot revision. |
| **Gateway Stays Offline > 7 Days** | WAN outage / router failure | Snapshot validity expires (`validUntil`); Gateway fails closed (DENY). Restore WAN connection to re-sync. |
| **Firmware Update Planned** | Scheduled security maintenance | Bench-test new firmware on standalone test bench with PHY-001–PHY-030 before deploying to production. |
