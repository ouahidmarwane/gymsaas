# GymFlow Access — Network Security & VLAN Architecture

## 1. Network Topology & Isolation

The access-control infrastructure operates on a strictly isolated Layer 2 / Layer 3 network segment (Access Control VLAN) with zero direct route from user, guest, or member Wi-Fi networks.

```
Internet (Cloudflare / GymFlow Cloud)
   ▲
   │ Outbound HTTPS (TCP 443) ONLY
   ▼
Edge Firewall / Gateway Router
   │
   ├────────────────────────────────────────┐
   ▼                                        ▼
Corporate / Staff LAN                 ACCESS CONTROL VLAN (VLAN 30)
(Admin Workstation)                   Subnet: 192.168.30.0/24
   │                                        │
   │ HTTPS / SSH (Restricted)               ├─ GymFlow Access Gateway (192.168.30.10)
   └───────────────────────────────────────►├─ Hikvision DS-K2602T (192.168.30.20)
                                            └─ Unmanaged/Isolated Switch
```

---

## 2. Firewall Access Control Lists (ACLs)

| Source | Destination | Protocol / Port | Purpose | Action |
| :--- | :--- | :--- | :--- | :--- |
| **GymFlow Gateway** | `*.gymflow.app` / Cloudflare (L7 Egress)* | TCP 443 (HTTPS) | Cloud M2M sync, Heartbeat, Snapshots | **PERMIT** |
| **GymFlow Gateway** | `192.168.30.20` (Controller) | TCP 80 / 443 (ISAPI) | alertStream, RemoteControl PUT | **PERMIT** |
| **GymFlow Gateway** | Local NTP / Gateway Router | UDP 123 (NTP) | Monotonic time sync | **PERMIT** |
| **DS-K2602T Controller**| `192.168.30.10` (Gateway) | TCP Established | alertStream response packets | **PERMIT** |
| **DS-K2602T Controller**| ANY / Internet | ANY | **Block all outbound Internet (NO DIRECT INTERNET ACCESS)** | **DENY** |
| **Member / Guest Wi-Fi**| VLAN 30 (Access Network) | ANY | Isolation from physical infrastructure | **DENY** |
| **ANY** | VLAN 30 | ANY | Default deny inter-VLAN routing | **DENY** |

*\*Note on Layer-4 vs Layer-7 Egress*: `*.gymflow.app` represents the conceptual Layer-7 FQDN egress destination. Traditional Layer-4 stateful firewalls cannot enforce DNS wildcard destination semantics safely without an outbound HTTPS proxy / FQDN-aware firewall or an explicitly maintained Cloudflare egress IP policy. Do not hardcode Cloudflare IP ranges into application software.

---

## 3. Host Hardening & SSRF Defense

1. **Strict Controller Host Allowlisting**:
   - The Gateway validator rejects link-local metadata addresses (`169.254.169.254`, `metadata.google.internal`), `0.0.0.0`, protocol wrappers (`http://`), and malformed hostnames.
2. **Digest Authentication Enforcement**:
   - ISAPI communication requires HTTP Digest Authentication (`qop=auth`, MD5/SHA-256) with dynamic nonces and request counters (`nc`).
   - Cleartext basic authentication is rejected.
3. **No Dynamic DNS / Rebinding**:
   - Controller IP should be statically assigned (`192.168.30.20`) with fixed DHCP reservation bound to the controller MAC address.

---

## 4. Residual Risk & Mitigation

- **Local HTTP on Isolated VLAN**:
  - *Risk*: Plaintext HTTP on VLAN 30 leaves Digest authorization headers and XML payloads observable to anyone with direct physical tap access to the switch.
  - *Mitigation*: Physical technical enclosure, conduit wiring, 802.1X port security, and strictly isolated broadcast domain.
