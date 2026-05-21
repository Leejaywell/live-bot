# Autonomous Desktop Companion Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first shippable Agent Core skeleton for the autonomous desktop companion: permissions, modes, audit logs, approval queue, world model, task manager, safety checks, tool gateway, and a deterministic dry-run loop.

**Architecture:** Add a new workspace crate, `crates/agent-core`, so the companion brain can evolve independently from Streamix Runtime. This first plan implements Phase 0 and Phase 1 from the spec, plus only local mock ports needed to verify the loop; Streamix HTTP/WebSocket integration, avatar adapters, real workspace control, and L6 execution are intentionally left for later plans.

**Tech Stack:** Rust 2024, serde, serde_json, chrono, anyhow, tokio for future async readiness, standard library collections and synchronization where needed.

---

## Scope Check

The approved spec covers several independent subsystems: Agent Core, Streamix Runtime API, Workspace Runtime, Avatar Runtime, Human Control Plane, L6 operations, and creator operations. This plan intentionally covers only the first independent subsystem:

1. Agent Core protocol and safety foundation.
2. Agent Core in-process skeleton loop.
3. Mock runtime ports for verification.

Do not implement:

- Streamix HTTP endpoints.
- Real browser automation.
- Real file writes.
- Real OBS or danmaku calls.
- Real avatar adapter.
- Real L6 execution.
- UI for approvals or tasks.

Those require separate plans after this core has tests.

## File Structure

Create:

- `crates/agent-core/Cargo.toml` - independent workspace crate manifest.
- `crates/agent-core/src/lib.rs` - public module exports.
- `crates/agent-core/src/types.rs` - shared permission, mode, action, risk, and result types.
- `crates/agent-core/src/audit.rs` - append-only in-memory audit log used by tests and later persistence adapters.
- `crates/agent-core/src/approval.rs` - approval queue for L4-L6 action requests.
- `crates/agent-core/src/world.rs` - current world state snapshot.
- `crates/agent-core/src/tasks.rs` - task inbox and task state transitions.
- `crates/agent-core/src/safety.rs` - permission, mode, budget, and L6 guard checks.
- `crates/agent-core/src/tools.rs` - tool registry and gateway.
- `crates/agent-core/src/runtime.rs` - deterministic Agent Core tick loop.
- `crates/agent-core/src/ports.rs` - mockable runtime port traits and local fake ports for tests.

Modify:

- `Cargo.toml` - add `crates/agent-core` to workspace members.

---

## Task 1: Add Agent Core Crate and Shared Types

**Files:**
- Modify: `Cargo.toml`
- Create: `crates/agent-core/Cargo.toml`
- Create: `crates/agent-core/src/lib.rs`
- Create: `crates/agent-core/src/types.rs`

- [ ] **Step 1: Add the crate to the workspace**

Modify the root `Cargo.toml` workspace members:

```toml
[workspace]
members = [
    "crates/agent-core",
    "crates/bilibili-live-protocol",
    "crates/voice",
]
exclude = ["third_party/RealtimeAPI/server"]
```

- [ ] **Step 2: Create the agent-core manifest**

Create `crates/agent-core/Cargo.toml`:

```toml
[package]
name = "streamix-agent-core"
version = "0.1.0"
edition = "2024"

[dependencies]
anyhow = "1.0.100"
chrono = { version = "0.4.42", default-features = false, features = ["clock", "serde"] }
serde = { version = "1.0.228", features = ["derive"] }
serde_json = "1.0.145"
tokio = { version = "1.48.0", features = ["macros", "rt", "time"] }
```

- [ ] **Step 3: Create public module exports**

Create `crates/agent-core/src/lib.rs`:

```rust
pub mod approval;
pub mod audit;
pub mod ports;
pub mod runtime;
pub mod safety;
pub mod tasks;
pub mod tools;
pub mod types;
pub mod world;

pub use approval::{ApprovalQueue, ApprovalRequest, ApprovalStatus};
pub use audit::{AuditLog, AuditRecord};
pub use runtime::{AgentCore, AgentCoreConfig, TickOutcome};
pub use safety::{SafetyDecision, SafetySupervisor};
pub use tasks::{TaskItem, TaskManager, TaskStatus};
pub use tools::{RegisteredTool, ToolGateway, ToolRegistry};
pub use types::{
    ActionEffect, ActionRequest, ActionResult, OperatingMode, PermissionLevel, RiskSummary,
};
pub use world::WorldModel;
```

- [ ] **Step 4: Define shared protocol types**

Create `crates/agent-core/src/types.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionLevel {
    L0Observe,
    L1SpeakChat,
    L2LiveControl,
    L3SandboxWork,
    L4ApprovedApp,
    L5AccountPublishing,
    L6HighRisk,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperatingMode {
    Observe,
    Assist,
    AutonomousLive,
    WorkAgent,
    Operator,
    Paused,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionEffect {
    ReadState,
    Speak,
    SendChat,
    LiveControl,
    SandboxWork,
    ApprovedApp,
    AccountPublishing,
    HighRisk,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RiskSummary {
    pub reason: String,
    pub impact: String,
    pub rollback: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionRequest {
    pub action_id: String,
    pub tool_name: String,
    pub permission_level: PermissionLevel,
    pub effect: ActionEffect,
    pub reason: String,
    pub payload: serde_json::Value,
    pub risk_summary: Option<RiskSummary>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionResult {
    Executed { message: String },
    QueuedForApproval { approval_id: String },
    Denied { reason: String },
    Skipped { reason: String },
}
```

- [ ] **Step 5: Add type serialization tests**

Append this test module to `crates/agent-core/src/types.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn permission_level_serializes_as_snake_case() {
        let value = serde_json::to_value(PermissionLevel::L6HighRisk).unwrap();
        assert_eq!(value, json!("l6_high_risk"));
    }

    #[test]
    fn action_request_round_trips() {
        let request = ActionRequest {
            action_id: "act-1".to_string(),
            tool_name: "sandbox.search".to_string(),
            permission_level: PermissionLevel::L3SandboxWork,
            effect: ActionEffect::SandboxWork,
            reason: "look up a safe reference".to_string(),
            payload: json!({"query": "stream schedule ideas"}),
            risk_summary: None,
            created_at: Utc::now(),
        };

        let encoded = serde_json::to_string(&request).unwrap();
        let decoded: ActionRequest = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded.action_id, "act-1");
        assert_eq!(decoded.permission_level, PermissionLevel::L3SandboxWork);
        assert_eq!(decoded.effect, ActionEffect::SandboxWork);
    }
}
```

- [ ] **Step 6: Run the type tests**

Run:

```bash
cargo test -p streamix-agent-core types
```

Expected: tests pass.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml crates/agent-core
git commit -m "feat(agent-core): add core protocol types"
```

---

## Task 2: Add Audit Log

**Files:**
- Create: `crates/agent-core/src/audit.rs`

- [ ] **Step 1: Write audit log tests**

Create `crates/agent-core/src/audit.rs` with tests first:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::types::{ActionRequest, ActionResult};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditRecord {
    pub id: u64,
    pub action_id: Option<String>,
    pub category: String,
    pub message: String,
    pub request: Option<ActionRequest>,
    pub result: Option<ActionResult>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Default)]
pub struct AuditLog {
    next_id: u64,
    records: Vec<AuditRecord>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_records_with_incrementing_ids() {
        let mut log = AuditLog::default();

        let first = log.record_event("mode", "entered observe mode");
        let second = log.record_event("watchdog", "heartbeat ok");

        assert_eq!(first.id, 1);
        assert_eq!(second.id, 2);
        assert_eq!(log.records().len(), 2);
        assert_eq!(log.records()[0].category, "mode");
    }

    #[test]
    fn records_action_result() {
        let mut log = AuditLog::default();
        let result = ActionResult::Denied {
            reason: "paused".to_string(),
        };

        let record = log.record_action_result("act-1", result.clone());

        assert_eq!(record.action_id.as_deref(), Some("act-1"));
        assert_eq!(record.result, Some(result));
    }
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cargo test -p streamix-agent-core audit
```

Expected: compile fails because `AuditLog::record_event`, `AuditLog::record_action_result`, and `AuditLog::records` are not implemented.

- [ ] **Step 3: Implement audit log methods**

Append below the `AuditLog` struct:

```rust
impl AuditLog {
    pub fn record_event(&mut self, category: impl Into<String>, message: impl Into<String>) -> AuditRecord {
        self.next_id += 1;
        let record = AuditRecord {
            id: self.next_id,
            action_id: None,
            category: category.into(),
            message: message.into(),
            request: None,
            result: None,
            created_at: Utc::now(),
        };
        self.records.push(record.clone());
        record
    }

    pub fn record_action_request(&mut self, request: ActionRequest) -> AuditRecord {
        self.next_id += 1;
        let record = AuditRecord {
            id: self.next_id,
            action_id: Some(request.action_id.clone()),
            category: "action_request".to_string(),
            message: format!("requested {}", request.tool_name),
            request: Some(request),
            result: None,
            created_at: Utc::now(),
        };
        self.records.push(record.clone());
        record
    }

    pub fn record_action_result(&mut self, action_id: impl Into<String>, result: ActionResult) -> AuditRecord {
        let action_id = action_id.into();
        self.next_id += 1;
        let record = AuditRecord {
            id: self.next_id,
            action_id: Some(action_id),
            category: "action_result".to_string(),
            message: "action completed".to_string(),
            request: None,
            result: Some(result),
            created_at: Utc::now(),
        };
        self.records.push(record.clone());
        record
    }

    pub fn records(&self) -> &[AuditRecord] {
        &self.records
    }
}
```

- [ ] **Step 4: Run audit tests**

Run:

```bash
cargo test -p streamix-agent-core audit
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/agent-core/src/audit.rs
git commit -m "feat(agent-core): add audit log"
```

---

## Task 3: Add Approval Queue

**Files:**
- Create: `crates/agent-core/src/approval.rs`

- [ ] **Step 1: Write approval queue tests**

Create `crates/agent-core/src/approval.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

use crate::types::{ActionRequest, ActionResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub approval_id: String,
    pub action: ActionRequest,
    pub status: ApprovalStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Default)]
pub struct ApprovalQueue {
    next_id: u64,
    pending: VecDeque<ApprovalRequest>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ActionEffect, PermissionLevel, RiskSummary};
    use serde_json::json;

    fn high_risk_action() -> ActionRequest {
        ActionRequest {
            action_id: "act-l6".to_string(),
            tool_name: "payments.purchase".to_string(),
            permission_level: PermissionLevel::L6HighRisk,
            effect: ActionEffect::HighRisk,
            reason: "buy approved test item".to_string(),
            payload: json!({"amount": 10}),
            risk_summary: Some(RiskSummary {
                reason: "test purchase".to_string(),
                impact: "spends sandbox balance".to_string(),
                rollback: "cancel order in test account".to_string(),
            }),
            created_at: Utc::now(),
        }
    }

    #[test]
    fn enqueues_pending_action() {
        let mut queue = ApprovalQueue::default();
        let result = queue.enqueue(high_risk_action());

        assert_eq!(result, ActionResult::QueuedForApproval {
            approval_id: "approval-1".to_string(),
        });
        assert_eq!(queue.pending().len(), 1);
        assert_eq!(queue.pending()[0].status, ApprovalStatus::Pending);
    }

    #[test]
    fn resolves_pending_action() {
        let mut queue = ApprovalQueue::default();
        queue.enqueue(high_risk_action());

        let resolved = queue.resolve("approval-1", ApprovalStatus::Approved).unwrap();

        assert_eq!(resolved.status, ApprovalStatus::Approved);
        assert!(queue.pending().is_empty());
    }
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cargo test -p streamix-agent-core approval
```

Expected: compile fails because `enqueue`, `pending`, and `resolve` are missing.

- [ ] **Step 3: Implement approval queue methods**

Append below `ApprovalQueue`:

```rust
impl ApprovalQueue {
    pub fn enqueue(&mut self, action: ActionRequest) -> ActionResult {
        self.next_id += 1;
        let approval_id = format!("approval-{}", self.next_id);
        let request = ApprovalRequest {
            approval_id: approval_id.clone(),
            action,
            status: ApprovalStatus::Pending,
            created_at: Utc::now(),
        };
        self.pending.push_back(request);
        ActionResult::QueuedForApproval { approval_id }
    }

    pub fn resolve(
        &mut self,
        approval_id: &str,
        status: ApprovalStatus,
    ) -> Option<ApprovalRequest> {
        let index = self
            .pending
            .iter()
            .position(|item| item.approval_id == approval_id)?;
        let mut request = self.pending.remove(index)?;
        request.status = status;
        Some(request)
    }

    pub fn pending(&self) -> Vec<ApprovalRequest> {
        self.pending.iter().cloned().collect()
    }
}
```

- [ ] **Step 4: Run approval tests**

Run:

```bash
cargo test -p streamix-agent-core approval
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/agent-core/src/approval.rs
git commit -m "feat(agent-core): add approval queue"
```

---

## Task 4: Add Safety Supervisor

**Files:**
- Create: `crates/agent-core/src/safety.rs`

- [ ] **Step 1: Write safety supervisor tests**

Create `crates/agent-core/src/safety.rs`:

```rust
use crate::types::{ActionRequest, ActionResult, OperatingMode, PermissionLevel};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SafetyDecision {
    Allow,
    QueueForApproval,
    Deny(String),
}

#[derive(Debug, Clone)]
pub struct SafetySupervisor {
    mode: OperatingMode,
    max_autonomous_permission: PermissionLevel,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ActionEffect, RiskSummary};
    use chrono::Utc;
    use serde_json::json;

    fn request(level: PermissionLevel, risk_summary: Option<RiskSummary>) -> ActionRequest {
        ActionRequest {
            action_id: "act".to_string(),
            tool_name: "tool".to_string(),
            permission_level: level,
            effect: ActionEffect::HighRisk,
            reason: "test".to_string(),
            payload: json!({}),
            risk_summary,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn paused_mode_denies_all_side_effects() {
        let supervisor = SafetySupervisor::new(OperatingMode::Paused, PermissionLevel::L3SandboxWork);
        let decision = supervisor.evaluate(&request(PermissionLevel::L1SpeakChat, None));

        assert_eq!(decision, SafetyDecision::Deny("agent is paused".to_string()));
    }

    #[test]
    fn l6_without_risk_summary_is_denied() {
        let supervisor = SafetySupervisor::new(OperatingMode::Operator, PermissionLevel::L6HighRisk);
        let decision = supervisor.evaluate(&request(PermissionLevel::L6HighRisk, None));

        assert_eq!(
            decision,
            SafetyDecision::Deny("l6 action requires risk_summary".to_string())
        );
    }

    #[test]
    fn l6_with_risk_summary_goes_to_approval() {
        let supervisor = SafetySupervisor::new(OperatingMode::Operator, PermissionLevel::L6HighRisk);
        let decision = supervisor.evaluate(&request(
            PermissionLevel::L6HighRisk,
            Some(RiskSummary {
                reason: "test".to_string(),
                impact: "sandbox only".to_string(),
                rollback: "discard sandbox".to_string(),
            }),
        ));

        assert_eq!(decision, SafetyDecision::QueueForApproval);
    }

    #[test]
    fn action_above_autonomous_limit_goes_to_approval() {
        let supervisor = SafetySupervisor::new(OperatingMode::AutonomousLive, PermissionLevel::L3SandboxWork);
        let decision = supervisor.evaluate(&request(PermissionLevel::L4ApprovedApp, None));

        assert_eq!(decision, SafetyDecision::QueueForApproval);
    }
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cargo test -p streamix-agent-core safety
```

Expected: compile fails because `SafetySupervisor::new` and `evaluate` are missing.

- [ ] **Step 3: Implement safety supervisor**

Append below `SafetySupervisor`:

```rust
impl SafetySupervisor {
    pub fn new(mode: OperatingMode, max_autonomous_permission: PermissionLevel) -> Self {
        Self {
            mode,
            max_autonomous_permission,
        }
    }

    pub fn mode(&self) -> OperatingMode {
        self.mode
    }

    pub fn set_mode(&mut self, mode: OperatingMode) {
        self.mode = mode;
    }

    pub fn evaluate(&self, action: &ActionRequest) -> SafetyDecision {
        if self.mode == OperatingMode::Paused {
            return SafetyDecision::Deny("agent is paused".to_string());
        }

        if action.permission_level == PermissionLevel::L6HighRisk && action.risk_summary.is_none() {
            return SafetyDecision::Deny("l6 action requires risk_summary".to_string());
        }

        if action.permission_level == PermissionLevel::L6HighRisk {
            return SafetyDecision::QueueForApproval;
        }

        if action.permission_level > self.max_autonomous_permission {
            return SafetyDecision::QueueForApproval;
        }

        match self.mode {
            OperatingMode::Observe => {
                if action.permission_level == PermissionLevel::L0Observe {
                    SafetyDecision::Allow
                } else {
                    SafetyDecision::QueueForApproval
                }
            }
            OperatingMode::Assist => {
                if action.permission_level <= PermissionLevel::L1SpeakChat {
                    SafetyDecision::Allow
                } else {
                    SafetyDecision::QueueForApproval
                }
            }
            OperatingMode::AutonomousLive => {
                if action.permission_level <= PermissionLevel::L3SandboxWork {
                    SafetyDecision::Allow
                } else {
                    SafetyDecision::QueueForApproval
                }
            }
            OperatingMode::WorkAgent => {
                if action.permission_level <= PermissionLevel::L4ApprovedApp {
                    SafetyDecision::Allow
                } else {
                    SafetyDecision::QueueForApproval
                }
            }
            OperatingMode::Operator => SafetyDecision::Allow,
            OperatingMode::Paused => SafetyDecision::Deny("agent is paused".to_string()),
        }
    }

    pub fn action_result_for_denial(reason: String) -> ActionResult {
        ActionResult::Denied { reason }
    }
}
```

- [ ] **Step 4: Run safety tests**

Run:

```bash
cargo test -p streamix-agent-core safety
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/agent-core/src/safety.rs
git commit -m "feat(agent-core): add safety supervisor"
```

---

## Task 5: Add Tool Registry and Gateway

**Files:**
- Create: `crates/agent-core/src/tools.rs`

- [ ] **Step 1: Write tool gateway tests**

Create `crates/agent-core/src/tools.rs`:

```rust
use std::collections::BTreeMap;

use crate::approval::ApprovalQueue;
use crate::audit::AuditLog;
use crate::safety::{SafetyDecision, SafetySupervisor};
use crate::types::{ActionRequest, ActionResult, PermissionLevel};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisteredTool {
    pub name: String,
    pub permission_level: PermissionLevel,
}

#[derive(Debug, Default)]
pub struct ToolRegistry {
    tools: BTreeMap<String, RegisteredTool>,
}

#[derive(Debug)]
pub struct ToolGateway {
    registry: ToolRegistry,
    safety: SafetySupervisor,
    approvals: ApprovalQueue,
    audit: AuditLog,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ActionEffect, OperatingMode, RiskSummary};
    use chrono::Utc;
    use serde_json::json;

    fn action(tool_name: &str, level: PermissionLevel) -> ActionRequest {
        ActionRequest {
            action_id: format!("act-{tool_name}"),
            tool_name: tool_name.to_string(),
            permission_level: level,
            effect: ActionEffect::SandboxWork,
            reason: "test tool".to_string(),
            payload: json!({}),
            risk_summary: None,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn unknown_tool_is_denied() {
        let mut gateway = ToolGateway::new(
            ToolRegistry::default(),
            SafetySupervisor::new(OperatingMode::AutonomousLive, PermissionLevel::L3SandboxWork),
        );

        let result = gateway.submit(action("missing", PermissionLevel::L1SpeakChat));

        assert_eq!(result, ActionResult::Denied {
            reason: "tool not registered: missing".to_string(),
        });
    }

    #[test]
    fn registered_safe_tool_executes() {
        let mut registry = ToolRegistry::default();
        registry.register("sandbox.search", PermissionLevel::L3SandboxWork);
        let mut gateway = ToolGateway::new(
            registry,
            SafetySupervisor::new(OperatingMode::AutonomousLive, PermissionLevel::L3SandboxWork),
        );

        let result = gateway.submit(action("sandbox.search", PermissionLevel::L3SandboxWork));

        assert_eq!(result, ActionResult::Executed {
            message: "executed sandbox.search".to_string(),
        });
    }

    #[test]
    fn l6_tool_is_queued() {
        let mut registry = ToolRegistry::default();
        registry.register("payments.purchase", PermissionLevel::L6HighRisk);
        let mut gateway = ToolGateway::new(
            registry,
            SafetySupervisor::new(OperatingMode::Operator, PermissionLevel::L6HighRisk),
        );
        let mut request = action("payments.purchase", PermissionLevel::L6HighRisk);
        request.effect = ActionEffect::HighRisk;
        request.risk_summary = Some(RiskSummary {
            reason: "test purchase".to_string(),
            impact: "sandbox balance only".to_string(),
            rollback: "discard sandbox order".to_string(),
        });

        let result = gateway.submit(request);

        assert_eq!(result, ActionResult::QueuedForApproval {
            approval_id: "approval-1".to_string(),
        });
        assert_eq!(gateway.pending_approvals().len(), 1);
    }
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cargo test -p streamix-agent-core tools
```

Expected: compile fails because registry and gateway methods are missing.

- [ ] **Step 3: Implement registry and gateway methods**

Append below `ToolGateway`:

```rust
impl ToolRegistry {
    pub fn register(&mut self, name: impl Into<String>, permission_level: PermissionLevel) {
        let name = name.into();
        self.tools.insert(
            name.clone(),
            RegisteredTool {
                name,
                permission_level,
            },
        );
    }

    pub fn get(&self, name: &str) -> Option<&RegisteredTool> {
        self.tools.get(name)
    }
}

impl ToolGateway {
    pub fn new(registry: ToolRegistry, safety: SafetySupervisor) -> Self {
        Self {
            registry,
            safety,
            approvals: ApprovalQueue::default(),
            audit: AuditLog::default(),
        }
    }

    pub fn submit(&mut self, action: ActionRequest) -> ActionResult {
        self.audit.record_action_request(action.clone());

        let Some(tool) = self.registry.get(&action.tool_name) else {
            let result = ActionResult::Denied {
                reason: format!("tool not registered: {}", action.tool_name),
            };
            self.audit
                .record_action_result(action.action_id, result.clone());
            return result;
        };

        if action.permission_level > tool.permission_level {
            let result = ActionResult::Denied {
                reason: format!(
                    "action permission {:?} exceeds tool permission {:?}",
                    action.permission_level, tool.permission_level
                ),
            };
            self.audit
                .record_action_result(action.action_id, result.clone());
            return result;
        }

        let result = match self.safety.evaluate(&action) {
            SafetyDecision::Allow => ActionResult::Executed {
                message: format!("executed {}", action.tool_name),
            },
            SafetyDecision::QueueForApproval => self.approvals.enqueue(action.clone()),
            SafetyDecision::Deny(reason) => ActionResult::Denied { reason },
        };

        self.audit
            .record_action_result(action.action_id, result.clone());
        result
    }

    pub fn pending_approvals(&self) -> Vec<crate::approval::ApprovalRequest> {
        self.approvals.pending()
    }

    pub fn audit_records(&self) -> &[crate::audit::AuditRecord] {
        self.audit.records()
    }
}
```

- [ ] **Step 4: Run tool tests**

Run:

```bash
cargo test -p streamix-agent-core tools
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/agent-core/src/tools.rs
git commit -m "feat(agent-core): add tool gateway"
```

---

## Task 6: Add World Model and Task Manager

**Files:**
- Create: `crates/agent-core/src/world.rs`
- Create: `crates/agent-core/src/tasks.rs`

- [ ] **Step 1: Create world model with tests**

Create `crates/agent-core/src/world.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::types::OperatingMode;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldModel {
    pub mode: OperatingMode,
    pub active_task_id: Option<String>,
    pub live_connected: bool,
    pub recent_events: Vec<String>,
    pub last_tick_at: Option<DateTime<Utc>>,
}

impl Default for WorldModel {
    fn default() -> Self {
        Self {
            mode: OperatingMode::Observe,
            active_task_id: None,
            live_connected: false,
            recent_events: Vec::new(),
            last_tick_at: None,
        }
    }
}

impl WorldModel {
    pub fn note_event(&mut self, event: impl Into<String>) {
        self.recent_events.push(event.into());
        if self.recent_events.len() > 50 {
            self.recent_events.remove(0);
        }
    }

    pub fn mark_tick(&mut self) {
        self.last_tick_at = Some(Utc::now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_model_keeps_recent_events_bounded() {
        let mut world = WorldModel::default();
        for idx in 0..60 {
            world.note_event(format!("event-{idx}"));
        }

        assert_eq!(world.recent_events.len(), 50);
        assert_eq!(world.recent_events[0], "event-10");
    }

    #[test]
    fn mark_tick_records_time() {
        let mut world = WorldModel::default();
        world.mark_tick();

        assert!(world.last_tick_at.is_some());
    }
}
```

- [ ] **Step 2: Create task manager with tests**

Create `crates/agent-core/src/tasks.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::types::PermissionLevel;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Inbox,
    Planned,
    Running,
    Blocked,
    WaitingApproval,
    Done,
    Failed,
    Archived,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskItem {
    pub task_id: String,
    pub title: String,
    pub status: TaskStatus,
    pub required_permission: PermissionLevel,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Default)]
pub struct TaskManager {
    next_id: u64,
    tasks: BTreeMap<String, TaskItem>,
}

impl TaskManager {
    pub fn add_task(
        &mut self,
        title: impl Into<String>,
        required_permission: PermissionLevel,
    ) -> TaskItem {
        self.next_id += 1;
        let now = Utc::now();
        let task = TaskItem {
            task_id: format!("task-{}", self.next_id),
            title: title.into(),
            status: TaskStatus::Inbox,
            required_permission,
            created_at: now,
            updated_at: now,
        };
        self.tasks.insert(task.task_id.clone(), task.clone());
        task
    }

    pub fn set_status(&mut self, task_id: &str, status: TaskStatus) -> Option<TaskItem> {
        let task = self.tasks.get_mut(task_id)?;
        task.status = status;
        task.updated_at = Utc::now();
        Some(task.clone())
    }

    pub fn get(&self, task_id: &str) -> Option<&TaskItem> {
        self.tasks.get(task_id)
    }

    pub fn all(&self) -> Vec<TaskItem> {
        self.tasks.values().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_inbox_task() {
        let mut tasks = TaskManager::default();
        let item = tasks.add_task("summarize stream", PermissionLevel::L1SpeakChat);

        assert_eq!(item.task_id, "task-1");
        assert_eq!(item.status, TaskStatus::Inbox);
        assert_eq!(tasks.all().len(), 1);
    }

    #[test]
    fn updates_task_status() {
        let mut tasks = TaskManager::default();
        let item = tasks.add_task("prepare segment", PermissionLevel::L3SandboxWork);

        let updated = tasks.set_status(&item.task_id, TaskStatus::Running).unwrap();

        assert_eq!(updated.status, TaskStatus::Running);
        assert_eq!(tasks.get(&item.task_id).unwrap().status, TaskStatus::Running);
    }
}
```

- [ ] **Step 3: Run world and task tests**

Run:

```bash
cargo test -p streamix-agent-core world
cargo test -p streamix-agent-core tasks
```

Expected: tests pass.

- [ ] **Step 4: Commit**

```bash
git add crates/agent-core/src/world.rs crates/agent-core/src/tasks.rs
git commit -m "feat(agent-core): add world and task state"
```

---

## Task 7: Add Ports and Deterministic Runtime Tick

**Files:**
- Create: `crates/agent-core/src/ports.rs`
- Create: `crates/agent-core/src/runtime.rs`

- [ ] **Step 1: Create runtime ports**

Create `crates/agent-core/src/ports.rs`:

```rust
use crate::types::ActionResult;

pub trait StreamixPort {
    fn recent_live_events(&self) -> Vec<String>;
}

pub trait WorkspacePort {
    fn sandbox_search(&self, query: &str) -> ActionResult;
}

pub trait AvatarPort {
    fn perform_semantic_action(&self, action: &str) -> ActionResult;
}

#[derive(Debug, Default)]
pub struct FakeStreamixPort {
    events: Vec<String>,
}

impl FakeStreamixPort {
    pub fn with_events(events: Vec<String>) -> Self {
        Self { events }
    }
}

impl StreamixPort for FakeStreamixPort {
    fn recent_live_events(&self) -> Vec<String> {
        self.events.clone()
    }
}

#[derive(Debug, Default)]
pub struct FakeWorkspacePort;

impl WorkspacePort for FakeWorkspacePort {
    fn sandbox_search(&self, query: &str) -> ActionResult {
        ActionResult::Executed {
            message: format!("searched sandbox for {query}"),
        }
    }
}

#[derive(Debug, Default)]
pub struct FakeAvatarPort;

impl AvatarPort for FakeAvatarPort {
    fn perform_semantic_action(&self, action: &str) -> ActionResult {
        ActionResult::Executed {
            message: format!("avatar action {action}"),
        }
    }
}
```

- [ ] **Step 2: Write runtime tests**

Create `crates/agent-core/src/runtime.rs`:

```rust
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::ports::StreamixPort;
use crate::safety::SafetySupervisor;
use crate::tasks::TaskManager;
use crate::tools::{ToolGateway, ToolRegistry};
use crate::types::{ActionEffect, ActionRequest, ActionResult, OperatingMode, PermissionLevel};
use crate::world::WorldModel;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentCoreConfig {
    pub mode: OperatingMode,
    pub max_autonomous_permission: PermissionLevel,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TickOutcome {
    pub observed_events: usize,
    pub action_results: Vec<ActionResult>,
}

pub struct AgentCore {
    world: WorldModel,
    tasks: TaskManager,
    gateway: ToolGateway,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ports::FakeStreamixPort;

    #[test]
    fn tick_records_live_events_and_idle_action() {
        let mut core = AgentCore::new(AgentCoreConfig {
            mode: OperatingMode::AutonomousLive,
            max_autonomous_permission: PermissionLevel::L3SandboxWork,
        });
        let port = FakeStreamixPort::with_events(vec![
            "danmaku: hello".to_string(),
            "gift: flower".to_string(),
        ]);

        let outcome = core.tick(&port);

        assert_eq!(outcome.observed_events, 2);
        assert_eq!(core.world().recent_events.len(), 2);
        assert_eq!(outcome.action_results, vec![ActionResult::Executed {
            message: "executed avatar.idle".to_string(),
        }]);
    }

    #[test]
    fn paused_tick_observes_but_does_not_execute_idle_action() {
        let mut core = AgentCore::new(AgentCoreConfig {
            mode: OperatingMode::Paused,
            max_autonomous_permission: PermissionLevel::L3SandboxWork,
        });
        let port = FakeStreamixPort::with_events(vec!["danmaku: hello".to_string()]);

        let outcome = core.tick(&port);

        assert_eq!(outcome.observed_events, 1);
        assert_eq!(outcome.action_results, vec![ActionResult::Denied {
            reason: "agent is paused".to_string(),
        }]);
    }

    #[test]
    fn task_manager_is_available() {
        let mut core = AgentCore::new(AgentCoreConfig {
            mode: OperatingMode::WorkAgent,
            max_autonomous_permission: PermissionLevel::L4ApprovedApp,
        });

        let task = core
            .tasks_mut()
            .add_task("prepare stream outline", PermissionLevel::L3SandboxWork);

        assert_eq!(task.task_id, "task-1");
        assert_eq!(core.tasks().all().len(), 1);
    }
}
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
cargo test -p streamix-agent-core runtime
```

Expected: compile fails because `AgentCore::new`, `tick`, `world`, `tasks`, and `tasks_mut` are missing.

- [ ] **Step 4: Implement deterministic runtime**

Append below `AgentCore`:

```rust
impl AgentCore {
    pub fn new(config: AgentCoreConfig) -> Self {
        let mut registry = ToolRegistry::default();
        registry.register("avatar.idle", PermissionLevel::L1SpeakChat);

        let safety = SafetySupervisor::new(config.mode, config.max_autonomous_permission);
        let gateway = ToolGateway::new(registry, safety);
        let mut world = WorldModel::default();
        world.mode = config.mode;

        Self {
            world,
            tasks: TaskManager::default(),
            gateway,
        }
    }

    pub fn tick(&mut self, streamix: &dyn StreamixPort) -> TickOutcome {
        let events = streamix.recent_live_events();
        for event in &events {
            self.world.note_event(event.clone());
        }
        self.world.mark_tick();

        let idle_action = ActionRequest {
            action_id: format!("tick-{}", Utc::now().timestamp_millis()),
            tool_name: "avatar.idle".to_string(),
            permission_level: PermissionLevel::L1SpeakChat,
            effect: ActionEffect::Speak,
            reason: "keep avatar alive during tick".to_string(),
            payload: serde_json::json!({"semantic_action": "idle"}),
            risk_summary: None,
            created_at: Utc::now(),
        };
        let result = self.gateway.submit(idle_action);

        TickOutcome {
            observed_events: events.len(),
            action_results: vec![result],
        }
    }

    pub fn world(&self) -> &WorldModel {
        &self.world
    }

    pub fn tasks(&self) -> &TaskManager {
        &self.tasks
    }

    pub fn tasks_mut(&mut self) -> &mut TaskManager {
        &mut self.tasks
    }
}
```

- [ ] **Step 5: Run runtime tests**

Run:

```bash
cargo test -p streamix-agent-core runtime
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
git add crates/agent-core/src/ports.rs crates/agent-core/src/runtime.rs
git commit -m "feat(agent-core): add runtime tick"
```

---

## Task 8: Run Full Agent Core Verification

**Files:**
- No file changes expected unless previous tasks revealed compile issues.

- [ ] **Step 1: Run all agent-core tests**

Run:

```bash
cargo test -p streamix-agent-core
```

Expected: all `streamix-agent-core` tests pass.

- [ ] **Step 2: Run workspace metadata check**

Run:

```bash
cargo metadata --no-deps --format-version 1
```

Expected: command succeeds and includes `"name":"streamix-agent-core"` in the JSON output.

- [ ] **Step 3: Confirm no Streamix runtime behavior changed**

Run:

```bash
git diff --stat HEAD
```

Expected: no pending changes after the previous commits. The only code changes in the branch should be the new crate plus the workspace member entry.

- [ ] **Step 4: Commit any verification fixes**

If Step 1 or Step 2 required small fixes, commit them:

```bash
git add Cargo.toml crates/agent-core
git commit -m "test(agent-core): verify core skeleton"
```

If no fixes were needed, skip this commit.

## Plan Self-Review

Spec coverage:

- Independent Agent Core service boundary: covered by new `crates/agent-core`.
- Permissions L0-L6: covered by Task 1 and Task 4.
- Approval queue and L6 risk summaries: covered by Task 3 and Task 4.
- Audit logs: covered by Task 2.
- World Model: covered by Task 6.
- Task Manager: covered by Task 6.
- Tool Gateway: covered by Task 5.
- Safety Supervisor: covered by Task 4.
- Watchdog: not implemented in this first plan because it needs async process/runtime supervision. It should be the first task in the next plan after the deterministic loop exists.
- Streamix thin integration: represented only as `StreamixPort` mock in Task 7. Real HTTP/WebSocket endpoints require a separate plan.
- Avatar semantic action model: represented by `avatar.idle` semantic tool and fake avatar port. Real adapter requires a separate plan.
- Workspace Runtime: represented by fake workspace port. Real browser/file/app tools require a separate plan.

Red-flag scan:

- This plan contains no open-ended implementation steps.
- Deferred systems are explicitly out of scope and assigned to later plans.

Type consistency:

- `PermissionLevel`, `OperatingMode`, `ActionRequest`, `ActionResult`, and `RiskSummary` are defined in Task 1 and reused consistently.
- `SafetySupervisor::evaluate` returns `SafetyDecision`, consumed by `ToolGateway::submit`.
- `ApprovalQueue::enqueue` returns `ActionResult::QueuedForApproval`, consumed by `ToolGateway::submit`.
