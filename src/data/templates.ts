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
  }
];
