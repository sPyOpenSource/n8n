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
  }
];
