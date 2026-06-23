import { WorkflowTemplate } from '../types/workflow';

export const TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'customer_sentiment_router',
    name: 'AI Support Sentiment Router',
    description: 'Ingests dynamic support payloads, routes automatically based on negative sentiment or refund demands, and drafts highly tailored recovery templates.',
    workflow: {
      name: 'AI Support Sentiment Router',
      description: 'Automatically prioritize and outline support draft responses depending on user urgency.',
      nodes: [
        {
          id: 'trigger_ticket',
          type: 'webhook',
          name: 'Support Webhook Mock',
          category: 'trigger',
          position: { x: 50, y: 150 },
          config: {
            payload: JSON.stringify({
              subject: "URGENT PAYMENT FAILURE / REFUND REQUEST",
              customerName: "Alex Vance",
              statusCode: "502-EXPIRED",
              content: "I paid for the premium plan twice but my status is still unpaid. This is ridiculous, please refund my duplicate payment immediately or I am canceling my account!"
            }, null, 2)
          }
        },
        {
          id: 'ai_check_sentiment',
          type: 'aiFilter',
          name: 'AI Sentiment Filter',
          category: 'ai',
          position: { x: 300, y: 150 },
          config: {
            condition: "Customer message conveys high frustration, anger, or explicitly demands a refund."
          }
        },
        {
          id: 'ai_priority_draft',
          type: 'aiTransform',
          name: 'Priority Apology Drafter',
          category: 'ai',
          position: { x: 580, y: 50 },
          config: {
            prompt: "Draft an urgent support email responding to {{customerName}}. Apologize sincerely for the payment glitch, assure them we are processing the dual payment refund immediately, and offer a free 1-month VIP extension to maintain client trust. Keep it premium and reassuring.",
            systemInstruction: "You are a professional Customer Success Lead handling high-priority escalations."
          }
        },
        {
          id: 'ai_standard_draft',
          type: 'aiTransform',
          name: 'Standard Ticket Responder',
          category: 'ai',
          position: { x: 580, y: 280 },
          config: {
            prompt: "Draft a dynamic standard response to customer {{customerName}}. Thank them for reaching out and outline clear steps to verify their subscription transaction.",
            systemInstruction: "You are a standard ticketing support agent."
          }
        },
        {
          id: 'log_priority_output',
          type: 'outputLog',
          name: 'Log Priority Queue',
          category: 'utility',
          position: { x: 860, y: 50 },
          config: {}
        },
        {
          id: 'log_standard_output',
          type: 'outputLog',
          name: 'Log General Queue',
          category: 'utility',
          position: { x: 860, y: 280 },
          config: {}
        }
      ],
      connections: [
        {
          id: 'conn1',
          fromId: 'trigger_ticket',
          fromPort: 'output',
          toId: 'ai_check_sentiment',
          toPort: 'input'
        },
        {
          id: 'conn2',
          fromId: 'ai_check_sentiment',
          fromPort: 'true',
          toId: 'ai_priority_draft',
          toPort: 'input'
        },
        {
          id: 'conn3',
          fromId: 'ai_check_sentiment',
          fromPort: 'false',
          toId: 'ai_standard_draft',
          toPort: 'input'
        },
        {
          id: 'conn4',
          fromId: 'ai_priority_draft',
          fromPort: 'output',
          toId: 'log_priority_output',
          toPort: 'input'
        },
        {
          id: 'conn5',
          fromId: 'ai_standard_draft',
          fromPort: 'output',
          toId: 'log_standard_output',
          toPort: 'input'
        }
      ]
    }
  },
  {
    id: 'daily_weather_drapter',
    name: 'Dynamic Weather & BTC Tweet Draft Generator',
    description: 'Pulls the current weather statistics for London and the live Bitcoin market price, merges their data, and uses AI to draft a witty daily finance/climate update tweet.',
    workflow: {
      name: 'Dynamic Weather & BTC Tweet Drafter',
      description: 'Merges London weather data and BTC financial prices to author dynamic tweets.',
      nodes: [
        {
          id: 'fetch_weather',
          type: 'customFetch',
          name: 'Fetch London Weather',
          category: 'trigger',
          position: { x: 50, y: 80 },
          config: {
            source: 'weather'
          }
        },
        {
          id: 'fetch_bitcoin',
          type: 'customFetch',
          name: 'Fetch BTC Price',
          category: 'trigger',
          position: { x: 50, y: 280 },
          config: {
            source: 'bitcoin'
          }
        },
        {
          id: 'js_merge',
          type: 'jsCode',
          name: 'Merge Feed Payloads',
          category: 'utility',
          position: { x: 320, y: 180 },
          config: {
            code: `// Merges the inputs manually
// 'input' contains current context. Since we running sequentially, let's map properties:
const weather = input.fetch_weather || { current_weather: { temperature: 15, windspeed: 8 } };
const btc = input.fetch_bitcoin || { bpi: { USD: { rate: "92,500" } } };

return {
  city: "London",
  temp: weather.current_weather ? weather.current_weather.temperature : "N/A",
  wind: weather.current_weather ? weather.current_weather.windspeed : "N/A",
  btcRate: btc.bpi ? btc.bpi.USD.rate : "Unknown",
  timestamp: new Date().toLocaleTimeString()
};`
          }
        },
        {
          id: 'ai_draft_tweet',
          type: 'aiTransform',
          name: 'Gemini Automated Tweet Writer',
          category: 'ai',
          position: { x: 580, y: 180 },
          config: {
            prompt: "Using the temp ({{temp}}°C) and BTC rates (${{btcRate}}), generate a punchy, humorous 240-character daily recap tweet. Include a couple of clever custom hashtags like #WeatherWatch or #BitcoinMarket. Make it sound like an experienced London trader-geek.",
            systemInstruction: "You are a professional social media manager."
          }
        },
        {
          id: 'logger_tweet',
          type: 'outputLog',
          name: 'Post Preview Output',
          category: 'utility',
          position: { x: 840, y: 180 },
          config: {}
        }
      ],
      connections: [
        {
          id: 'conn_m1',
          fromId: 'fetch_weather',
          fromPort: 'output',
          toId: 'js_merge',
          toPort: 'input'
        },
        {
          id: 'conn_m2',
          fromId: 'fetch_bitcoin',
          fromPort: 'output',
          toId: 'js_merge',
          toPort: 'input'
        },
        {
          id: 'conn_m3',
          fromId: 'js_merge',
          fromPort: 'output',
          toId: 'ai_draft_tweet',
          toPort: 'input'
        },
        {
          id: 'conn_m4',
          fromId: 'ai_draft_tweet',
          fromPort: 'output',
          toId: 'logger_tweet',
          toPort: 'input'
        }
      ]
    }
  },
  {
    id: 'intelligent_triage_flow',
    name: 'Multi-Path Ticket Triage Router',
    description: 'Ingests multi-category customer desk queries, evaluates categories using the Transform Router, and directs tickets across specialized response streams.',
    workflow: {
      name: 'Multi-Path Ticket Triage Router',
      description: 'Intelligent multi-destination customer care triage.',
      nodes: [
        {
          id: 'ticket_trigger',
          type: 'webhook',
          name: 'Dynamic Query Ticket Feed',
          category: 'trigger',
          position: { x: 50, y: 190 },
          config: {
            payload: JSON.stringify({
              customerName: "Jane Doe",
              issueType: "billing",
              description: "I received a duplicate monthly charge of $29 after updating my visa card status. Please check and reverse!"
            }, null, 2)
          }
        },
        {
          id: 'router_ticket',
          type: 'transformRouter',
          name: 'Triage Router Processor',
          category: 'ai',
          position: { x: 300, y: 170 },
          config: {
            routingMode: 'rules',
            routeKey: 'issueType',
            routeAMatch: 'billing',
            routeBMatch: 'feedback',
            routeCMatch: 'technical'
          }
        },
        {
          id: 'ai_billing_draft',
          type: 'aiTransform',
          name: 'Finance Refund Helper',
          category: 'ai',
          position: { x: 580, y: 40 },
          config: {
            prompt: "Prepare a billing refund ticket confirmation template for customer {{customerName}}. Thank them matching issueType {{issueType}} and guarantee resolution.",
            systemInstruction: "You are an automated accounting robot."
          }
        },
        {
          id: 'ai_feedback_draft',
          type: 'aiTransform',
          name: 'Feedback Recognition Builder',
          category: 'ai',
          position: { x: 580, y: 190 },
          config: {
            prompt: "Prepare a warm appreciation draft response thanking {{customerName}} for sharing their customer feedback.",
            systemInstruction: "You are a customer feedback specialist."
          }
        },
        {
          id: 'ai_technical_draft',
          type: 'aiTransform',
          name: 'Technical Bug Logger',
          category: 'ai',
          position: { x: 580, y: 340 },
          config: {
            prompt: "Draft a technical ticket escalation notice to engineering for {{customerName}} experiencing difficulty.",
            systemInstruction: "You are a professional IT sysadmin."
          }
        },
        {
          id: 'triage_terminal',
          type: 'outputLog',
          name: 'Escalated Triage Terminal',
          category: 'utility',
          position: { x: 860, y: 190 },
          config: {}
        }
      ],
      connections: [
        {
          id: 'conn_t1',
          fromId: 'ticket_trigger',
          fromPort: 'output',
          toId: 'router_ticket',
          toPort: 'input'
        },
        {
          id: 'conn_t2',
          fromId: 'router_ticket',
          fromPort: 'routeA',
          toId: 'ai_billing_draft',
          toPort: 'input'
        },
        {
          id: 'conn_t3',
          fromId: 'router_ticket',
          fromPort: 'routeB',
          toId: 'ai_feedback_draft',
          toPort: 'input'
        },
        {
          id: 'conn_t4',
          fromId: 'router_ticket',
          fromPort: 'routeC',
          toId: 'ai_technical_draft',
          toPort: 'input'
        },
        {
          id: 'conn_t5',
          fromId: 'ai_billing_draft',
          fromPort: 'output',
          toId: 'triage_terminal',
          toPort: 'input'
        },
        {
          id: 'conn_t6',
          fromId: 'ai_feedback_draft',
          fromPort: 'output',
          toId: 'triage_terminal',
          toPort: 'input'
        },
        {
          id: 'conn_t7',
          fromId: 'ai_technical_draft',
          fromPort: 'output',
          toId: 'triage_terminal',
          toPort: 'input'
        }
      ]
    }
  },
  {
    id: 'openswarm_copy_refiner',
    name: 'OpenSwarm Multi-Agent Content Refiner',
    description: 'Uses a synchronized team of expert swarm agents (Planner, Transformation Writer, and Optimizing Auditor) to review, restructure, and deliver pristine copies.',
    workflow: {
      name: 'OpenSwarm Multi-Agent Content Refiner',
      description: 'Collaborative Multi-Agent Refinement Pipeline.',
      nodes: [
        {
          id: 'swarm_trigger',
          type: 'webhook',
          name: 'Draft Article Feed',
          category: 'trigger',
          position: { x: 80, y: 160 },
          config: {
            payload: JSON.stringify({
              author: "Marcus Aurelius",
              mode: "Brutalist Editorial",
              draftContent: "OpenSwarm integrations is powerful because it allows separate ai profiles representing planner, executor, and reviewer to talk together and make better output than single model. we should implement it for workflow automation"
            }, null, 2)
          }
        },
        {
          id: 'swarm_refiner',
          type: 'openSwarm',
          name: 'OpenSwarm Collaborative Refiner',
          category: 'ai',
          position: { x: 380, y: 140 },
          config: {
            swarmInstructions: "Deconstruct the drafting text in draftContent. Have the agents outline editing directives, write a highly professional and refined paragraph embodying mode \"{{mode}}\", correct all formatting, and output the polished final product as a clean JSON layout.",
            swarmMaxTurns: 3,
            swarmAgents: JSON.stringify([
              { "name": "Planner Agent", "instructions": "Deconstruct instructions, formulate execution roadmap." },
              { "name": "Transformation Writer", "instructions": "Formulate beautiful responses and format them perfectly." },
              { "name": "Optimizing Auditor", "instructions": "Apply quality reviews, verify data fields, correct errors." }
            ], null, 2)
          }
        },
        {
          id: 'swarm_logger',
          type: 'outputLog',
          name: 'Refinement Output Terminal',
          category: 'utility',
          position: { x: 740, y: 160 },
          config: {}
        }
      ],
      connections: [
        {
          id: 'conn_sw1',
          fromId: 'swarm_trigger',
          fromPort: 'output',
          toId: 'swarm_refiner',
          toPort: 'input'
        },
        {
          id: 'conn_sw2',
          fromId: 'swarm_refiner',
          fromPort: 'output',
          toId: 'swarm_logger',
          toPort: 'input'
        }
      ]
    }
  },
  {
    id: 'hermes_compliance_analyst',
    name: 'Hermes Deep Reasoning & Compliance Analyst',
    description: 'Models multi-tier, high-fidelity root cause analyses of transactional and operational system glitches using the custom self-correcting Hermes CoT Engine.',
    workflow: {
      name: 'Hermes Compliance Analyst',
      description: 'Step-wise Cognitive Resolution Workspace.',
      nodes: [
        {
          id: 'complaint_trigger',
          type: 'webhook',
          name: 'Inbound Customer Incident',
          category: 'trigger',
          position: { x: 80, y: 160 },
          config: {
            payload: JSON.stringify({
              userId: "u_99182",
              subscriptionTier: "Enterprise VIP",
              message: "Since 4 days ago, database syncing has completely broken during batch CSV processing. We were dual-charged twice for $4,500. This is blocking our core Q2 deployment pipelines!",
              region: "EU-West"
            }, null, 2)
          }
        },
        {
          id: 'hermes_core',
          type: 'hermesAgent',
          name: 'Hermes Incident Analyst',
          category: 'ai',
          position: { x: 380, y: 140 },
          config: {
            hermesInstructions: "Deconstruct the failure report provided in 'message' from customer 'userId' (tier: 'subscriptionTier'). Plan an incident response roadmap, model a technical root-cause hypotheses, assess billing remediation details for high-value refund demands, and output a detailed executive action blueprint.",
            hermesPersona: 'reasoning',
            hermesTemperature: 0.15,
            hermesStepWise: true
          }
        },
        {
          id: 'hermes_logger',
          type: 'outputLog',
          name: 'Incident Compliance Terminal',
          category: 'utility',
          position: { x: 740, y: 160 },
          config: {}
        }
      ],
      connections: [
        {
          id: 'conn_h1',
          fromId: 'complaint_trigger',
          fromPort: 'output',
          toId: 'hermes_core',
          toPort: 'input'
        },
        {
          id: 'conn_h2',
          fromId: 'hermes_core',
          fromPort: 'output',
          toId: 'hermes_logger',
          toPort: 'input'
        }
      ]
    }
  },
  {
    id: 'opencode_sandbox_compiler',
    name: 'OpenCode Sandbox Formula Compiler',
    description: 'Deconstructs computational telemetry records, compiles optimized sandboxed Python/JS statistics routines, and runs automated verification loops.',
    workflow: {
      name: 'OpenCode Telemetry Compiler',
      description: 'Automated Code Generation & Sandbox VM validation.',
      nodes: [
        {
          id: 'telemetry_data',
          type: 'webhook',
          name: 'Inbound System Telemetry',
          category: 'trigger',
          position: { x: 80, y: 160 },
          config: {
            payload: JSON.stringify({
              service: "core-payment-gateway",
              metrics: [
                { "req_id": "tx_201", "latency_ms": 142, "statusCode": 200 },
                { "req_id": "tx_202", "latency_ms": 3105, "statusCode": 504 },
                { "req_id": "tx_203", "latency_ms": 98, "statusCode": 200 },
                { "req_id": "tx_204", "latency_ms": 412, "statusCode": 500 },
                { "req_id": "tx_205", "latency_ms": 115, "statusCode": 200 }
              ]
            }, null, 2)
          }
        },
        {
          id: 'opencode_processor',
          type: 'opencodeAgent',
          name: 'Telemetry Formula Compiler',
          category: 'ai',
          position: { x: 380, y: 140 },
          config: {
            opencodeInstructions: "Parse the active 'metrics' list from the inbound system telemetry. Generate a custom program to compute the average latency of successful requests (statusCode == 200), compute search outlier tags for requests with latency exceeding 400ms, and format the output results clearly.",
            opencodeLanguage: 'javascript',
            opencodeSandboxMode: 'execute',
            opencodeAutoCorrect: true
          }
        },
        {
          id: 'opencode_logger',
          type: 'outputLog',
          name: 'Telemetry Verification Logger',
          category: 'utility',
          position: { x: 740, y: 160 },
          config: {}
        }
      ],
      connections: [
        {
          id: 'conn_oc1',
          fromId: 'telemetry_data',
          fromPort: 'output',
          toId: 'opencode_processor',
          toPort: 'input'
        },
        {
          id: 'conn_oc2',
          fromId: 'opencode_processor',
          fromPort: 'output',
          toId: 'opencode_logger',
          toPort: 'input'
        }
      ]
    }
  },
  {
    id: 'custom_agent_research_pipeline',
    name: 'Custom Skill Agent Synthesis Pipeline',
    description: 'Deploys an autonomous custom skill agent configured with live web search, memory sync, and arithmetic calculators to build hyper-targeted corporate portfolios.',
    workflow: {
      name: 'Custom Agent Synthesis Workspace',
      description: 'Dynamic multi-skill validation and automated intelligence pipeline.',
      nodes: [
        {
          id: 'corp_trigger',
          type: 'webhook',
          name: 'Inbound Customer Account Profile',
          category: 'trigger',
          position: { x: 80, y: 160 },
          config: {
            payload: JSON.stringify({
              customerName: "Sovereign Maritime Tracking",
              headcount: 1420,
              growthFactor: 1.22,
              industry: "Maritime Supply Chains"
            }, null, 2)
          }
        },
        {
          id: 'skill_agent_core',
          type: 'customAgent',
          name: 'Custom Market Analyst',
          category: 'ai',
          position: { x: 380, y: 140 },
          config: {
            customAgentInstructions: "Ingest client 'customerName' from maritime tracking. Run a live search on active industry parameters in 'industry', execute sandbox metrics computation based on 'headcount' * 'growthFactor' to yield a capacity score, sync historic memory logs, and deliver a formatted portfolio asset.",
            customAgentModel: 'gemini-3.5-flash',
            customAgentTemperature: 0.35,
            customAgentSkills: ['search', 'calc', 'memory', 'formatter', 'translator']
          }
        },
        {
          id: 'skill_agent_logger',
          type: 'outputLog',
          name: 'Market Intelligence Terminal',
          category: 'utility',
          position: { x: 740, y: 160 },
          config: {}
        }
      ],
      connections: [
        {
          id: 'conn_ca1',
          fromId: 'corp_trigger',
          fromPort: 'output',
          toId: 'skill_agent_core',
          toPort: 'input'
        },
        {
          id: 'conn_ca2',
          fromId: 'skill_agent_core',
          fromPort: 'output',
          toId: 'skill_agent_logger',
          toPort: 'input'
        }
      ]
    }
  },
  {
    id: 'mcp_rag_compliance_engine',
    name: 'MCP & RAG SLA Compliance Engine',
    description: 'Autonomous support pipeline. Leverages vector semantic databases to fetch corporate response SLAs, executes MCP client tool protocols to fetch production DB schemas, and synthesizes accurate compliance audits.',
    workflow: {
      name: 'MCP & RAG Integration Workflow',
      description: 'End-to-end grounded compliance pipeline.',
      nodes: [
        {
          id: 'ticket_trigger',
          type: 'webhook',
          name: 'Inbound Customer Ticket',
          category: 'trigger',
          position: { x: 40, y: 160 },
          config: {
            payload: JSON.stringify({
              customerName: "Hyperion Defense Systems",
              priority: "high",
              message: "Please audit our compliance with refund protocols. Also fetch active table structure for database validation."
            }, null, 2)
          }
        },
        {
          id: 'rag_vector_index',
          type: 'ragEngine',
          name: 'Corporate SLA Search (RAG)',
          category: 'ai',
          position: { x: 300, y: 70 },
          config: {
            ragSourceType: 'text',
            ragQuery: 'refund escalation SLA protocols',
            ragChunkSize: 450,
            ragVectorSearchMetric: 'cosine',
            ragKnowledgeBase: 'SLA Escalations Guidelines:\n- Priority 1 (Severe): Refund within 2 hours of verification\n- Priority 2: Response within 24 hours\n- Escalation point contact: compliance-officer@sovereign.com'
          }
        },
        {
          id: 'mcp_db_connector',
          type: 'mcpClient',
          name: 'Production DB Schema (MCP)',
          category: 'ai',
          position: { x: 300, y: 260 },
          config: {
            mcpServerUrl: 'http://localhost:4500/mcp',
            mcpMethod: 'callTool',
            mcpToolName: 'query_db_schema',
            mcpArguments: '{\n  "table": "users",\n  "columns": ["id", "email", "tier"]\n}'
          }
        },
        {
          id: 'compliance_synthesizer',
          type: 'customAgent',
          name: 'Grounded Audit Agent',
          category: 'ai',
          position: { x: 580, y: 160 },
          config: {
            customAgentInstructions: "We received ticket message: '{{ticket_trigger.message}}'.\n\nVerify compliance using retrieved RAG guidelines:\n{{rag_vector_index.retrievedContext}}\n\nCombine this with MCP schema results:\n{{mcp_db_connector.mcpResponse}}\n\nCompose a hyper-grounded corporate response draft addressing refund rules and the retrieved table schema.",
            customAgentModel: 'gemini-3.5-flash',
            customAgentTemperature: 0.25,
            customAgentSkills: ['formatter', 'translator']
          }
        },
        {
          id: 'audit_terminal',
          type: 'outputLog',
          name: 'Archival Storage & Logs',
          category: 'utility',
          position: { x: 840, y: 170 },
          config: {}
        }
      ],
      connections: [
        {
          id: 'conn_r1',
          fromId: 'ticket_trigger',
          fromPort: 'output',
          toId: 'rag_vector_index',
          toPort: 'input'
        },
        {
          id: 'conn_r2',
          fromId: 'ticket_trigger',
          fromPort: 'output',
          toId: 'mcp_db_connector',
          toPort: 'input'
        },
        {
          id: 'conn_r3',
          fromId: 'rag_vector_index',
          fromPort: 'output',
          toId: 'compliance_synthesizer',
          toPort: 'input'
        },
        {
          id: 'conn_r4',
          fromId: 'mcp_db_connector',
          fromPort: 'output',
          toId: 'compliance_synthesizer',
          toPort: 'input'
        },
        {
          id: 'conn_r5',
          fromId: 'compliance_synthesizer',
          fromPort: 'output',
          toId: 'audit_terminal',
          toPort: 'input'
        }
      ]
    }
  },
  {
    id: 'model_fine_tuning_pipeline',
    name: 'LoRA Adapter Fine-Tuning Pipeline',
    description: 'Structure inbound feedback streams, format them as instruction pairs, and train a custom high-performance adapter using custom optimizers and epochs.',
    workflow: {
      name: 'Model Fine-Tuning & Evaluation Pipeline',
      description: 'Continuous instruction tuning workflow.',
      nodes: [
        {
          id: 'raw_inputs',
          type: 'webhook',
          name: 'Feedback Payload Stream',
          category: 'trigger',
          position: { x: 40, y: 180 },
          config: {
            payload: JSON.stringify({
              issue: "Refund needed immediately! Your software lacks premium scaling.",
              supportTier: "VIP Gold",
              sentimentExpected: "NEGATIVE_CRITICAL"
            }, null, 2)
          }
        },
        {
          id: 'cleaner_formatter',
          type: 'jsCode',
          name: 'Structure Training Pairs',
          category: 'utility',
          position: { x: 280, y: 180 },
          config: {
            code: 'const input = JSON.parse(context.raw_inputs || "{}");\nreturn [\n  {\n    "prompt": `Classification task: ${input.issue || ""}`,\n    "completion": `SENTIMENT: ${input.sentimentExpected || "UNKNOWN"}`\n  }\n];'
          }
        },
        {
          id: 'lora_tuner',
          type: 'modelTraining',
          name: 'LoRA Fine-Tuner',
          category: 'utility',
          position: { x: 520, y: 180 },
          config: {
            trainingBaseModel: 'gemini-3.5-flash',
            trainingDatasetSize: 5000,
            trainingEpochs: 6,
            trainingLearningRate: 0.00025,
            trainingBatchSize: 16,
            trainingLossFunction: 'cross_entropy',
            trainingOptimizer: 'adamw',
            trainingPromptDataset: '{{\n  cleaner_formatter\n}}'
          }
        },
        {
          id: 'evaluator_report',
          type: 'customAgent',
          name: 'Adapter Audit Specialist',
          category: 'utility',
          position: { x: 760, y: 180 },
          config: {
            customAgentInstructions: "Verify the fine-tuning training output from lora_tuner:\n{{lora_tuner}}\n\nCompile a professional training completion summary detailing learning decay, weight checkpoint validation, and downstream inference parameters.",
            customAgentModel: 'gemini-3.5-flash',
            customAgentTemperature: 0.2
          }
        }
      ],
      connections: [
        {
          id: 'conn_ft1',
          fromId: 'raw_inputs',
          fromPort: 'output',
          toId: 'cleaner_formatter',
          toPort: 'input'
        },
        {
          id: 'conn_ft2',
          fromId: 'cleaner_formatter',
          fromPort: 'output',
          toId: 'lora_tuner',
          toPort: 'input'
        },
        {
          id: 'conn_ft3',
          fromId: 'lora_tuner',
          fromPort: 'output',
          toId: 'evaluator_report',
          toPort: 'input'
        }
      ]
    }
  }
];
