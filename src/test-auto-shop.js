/**
 * CakraNode - Auto Shop Testing
 * Test script untuk auto buy items dari shop
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bedrock from 'bedrock-protocol';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load config
const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Shop configuration
const SHOP_CONFIG = {
  targetCategory: process.argv[2] || 'shard',        // Kategori (dari CLI arg atau default)
  targetItem: process.argv[3] || 'skeleton spawner', // Item (dari CLI arg atau default)
  quantity: parseInt(process.argv[4]) || 1,          // Jumlah (dari CLI arg atau default)
  autoConfirm: true,                                 // Auto confirm pembelian
  debugMode: process.argv.includes('--debug'),       // Debug all packets
};

// Logger
function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function logInfo(msg) { console.log(`[${getTimestamp()}] [INFO]: ${msg}`); }
function logWarn(msg) { console.log(`[${getTimestamp()}] [WARN]: ${msg}`); }
function logError(msg) { console.log(`[${getTimestamp()}] [ERROR]: ${msg}`); }
function logDebug(msg) { console.log(`[${getTimestamp()}] [DEBUG]: ${msg}`); }

// State machine untuk navigasi shop
let shopState = {
  active: false,
  currentStep: 'idle', // idle, waiting_category, waiting_item, waiting_quantity, waiting_confirm
  lastFormId: null,
  categoryButtonId: null,
  itemButtonId: null,
};

// Parse form data untuk mencari button yang sesuai
function parseFormButtons(formData) {
  try {
    const buttons = [];
    
    // Form bisa berupa simple_form atau modal_form
    if (formData.type === 'form') {
      // Simple form dengan buttons array
      if (formData.buttons && Array.isArray(formData.buttons)) {
        formData.buttons.forEach((button, index) => {
          const text = button.text?.toLowerCase() || '';
          buttons.push({ index, text, type: 'simple' });
        });
      }
    } else if (formData.type === 'custom_form') {
      // Custom form dengan input fields
      if (formData.content && Array.isArray(formData.content)) {
        formData.content.forEach((field, index) => {
          if (field.type === 'dropdown' && field.options) {
            field.options.forEach((option, optIndex) => {
              const text = option.toLowerCase();
              buttons.push({ index, optIndex, text, type: 'dropdown' });
            });
          } else if (field.type === 'slider') {
            buttons.push({ index, type: 'slider', min: field.min, max: field.max, default: field.default });
          }
        });
      }
    }
    
    return buttons;
  } catch (err) {
    logError(`Failed to parse form: ${err.message}`);
    return [];
  }
}

// Find button by text pattern
function findButton(buttons, pattern) {
  const lowerPattern = pattern.toLowerCase();
  return buttons.find(btn => btn.text && btn.text.includes(lowerPattern));
}

// Handle modal form request (shop UI)
function handleModalForm(client, packet) {
  try {
    logDebug(`Received form: ${packet.form_id}`);
    
    // Parse form JSON
    let formData;
    try {
      formData = JSON.parse(packet.data);
    } catch (err) {
      logWarn(`Failed to parse form data: ${err.message}`);
      return;
    }
    
    logDebug(`Form type: ${formData.type}, Title: ${formData.title || 'N/A'}`);
    
    const title = (formData.title || '').toLowerCase();
    shopState.lastFormId = packet.form_id;
    
    // Step 1: Main shop menu - pilih kategori
    if (shopState.currentStep === 'waiting_category' || title.includes('shop') && !title.includes('confirm')) {
      const buttons = parseFormButtons(formData);
      logInfo(`Searching for category: ${SHOP_CONFIG.targetCategory}`);
      
      const categoryBtn = findButton(buttons, SHOP_CONFIG.targetCategory);
      if (categoryBtn) {
        logInfo(`✓ Found category button at index ${categoryBtn.index}: ${categoryBtn.text}`);
        shopState.categoryButtonId = categoryBtn.index;
        shopState.currentStep = 'waiting_item';
        
        // Send form response untuk pilih kategori
        setTimeout(() => {
          client.write('modal_form_response', {
            form_id: packet.form_id,
            data: JSON.stringify(categoryBtn.index),
          });
          logInfo(`→ Selected category: ${categoryBtn.text}`);
        }, 500);
        return;
      } else {
        logWarn(`Category "${SHOP_CONFIG.targetCategory}" not found in buttons`);
        logDebug(`Available buttons: ${buttons.map(b => b.text).join(', ')}`);
        shopState.active = false;
      }
    }
    
    // Step 2: Category items - pilih item
    else if (shopState.currentStep === 'waiting_item') {
      const buttons = parseFormButtons(formData);
      logInfo(`Searching for item: ${SHOP_CONFIG.targetItem}`);
      
      const itemBtn = findButton(buttons, SHOP_CONFIG.targetItem);
      if (itemBtn) {
        logInfo(`✓ Found item button at index ${itemBtn.index}: ${itemBtn.text}`);
        shopState.itemButtonId = itemBtn.index;
        shopState.currentStep = 'waiting_quantity';
        
        // Send form response untuk pilih item
        setTimeout(() => {
          client.write('modal_form_response', {
            form_id: packet.form_id,
            data: JSON.stringify(itemBtn.index),
          });
          logInfo(`→ Selected item: ${itemBtn.text}`);
        }, 500);
        return;
      } else {
        logWarn(`Item "${SHOP_CONFIG.targetItem}" not found in category`);
        logDebug(`Available items: ${buttons.map(b => b.text).join(', ')}`);
        shopState.active = false;
      }
    }
    
    // Step 3: Quantity input (custom form with slider/input)
    else if (shopState.currentStep === 'waiting_quantity') {
      logInfo(`Entering quantity: ${SHOP_CONFIG.quantity}`);
      shopState.currentStep = 'waiting_confirm';
      
      // Custom form biasanya punya array of inputs
      // Response format: array of values
      const responseData = [SHOP_CONFIG.quantity]; // Quantity input
      
      setTimeout(() => {
        client.write('modal_form_response', {
          form_id: packet.form_id,
          data: JSON.stringify(responseData),
        });
        logInfo(`→ Entered quantity: ${SHOP_CONFIG.quantity}`);
      }, 500);
      return;
    }
    
    // Step 4: Confirmation
    else if (shopState.currentStep === 'waiting_confirm' || title.includes('confirm')) {
      const buttons = parseFormButtons(formData);
      logInfo(`Confirmation screen detected`);
      
      if (SHOP_CONFIG.autoConfirm) {
        // Cari button "yes", "confirm", "buy", etc
        const confirmBtn = findButton(buttons, 'yes') || 
                          findButton(buttons, 'confirm') || 
                          findButton(buttons, 'buy') ||
                          buttons[0]; // Fallback to first button
        
        if (confirmBtn) {
          logInfo(`✓ Confirming purchase with button: ${confirmBtn.text || 'index ' + confirmBtn.index}`);
          
          setTimeout(() => {
            client.write('modal_form_response', {
              form_id: packet.form_id,
              data: JSON.stringify(confirmBtn.index),
            });
            logInfo(`→ Purchase confirmed!`);
            shopState.active = false;
            shopState.currentStep = 'idle';
          }, 500);
          return;
        }
      } else {
        logWarn(`Auto-confirm disabled, canceling...`);
        // Send cancel (biasanya null atau index terakhir)
        client.write('modal_form_response', {
          form_id: packet.form_id,
          data: null,
        });
        shopState.active = false;
        shopState.currentStep = 'idle';
      }
    }
    
  } catch (err) {
    logError(`Error handling modal form: ${err.message}`);
    shopState.active = false;
  }
}

// Main test function
async function testAutoShop() {
  logInfo('=== Auto Shop Test ===');
  logInfo(`Target: ${SHOP_CONFIG.targetItem} from ${SHOP_CONFIG.targetCategory} category`);
  logInfo(`Quantity: ${SHOP_CONFIG.quantity}`);
  logInfo(`Debug mode: ${SHOP_CONFIG.debugMode ? 'ENABLED' : 'disabled'}`);
  logInfo(`CLI Usage: node src/test-auto-shop.js [category] [item] [quantity] [--debug]`);
  logInfo(`Example: node src/test-auto-shop.js shard "skeleton spawner" 1 --debug`);
  
  // Create client
  const username = config.testBot?.username || 'TestBot';
  const server_ip = config.testBot?.server_ip || config.server.ip;
  const server_port = config.testBot?.server_port || config.server.port;
  const offline_mode = config.testBot?.offline_mode === true;
  
  logInfo(`Connecting as ${username} to ${server_ip}:${server_port}...`);
  logInfo(`Mode: ${offline_mode ? 'Offline (no auth)' : 'Online (Xbox auth required)'}`);
  
  if (!offline_mode) {
    logWarn(`Watch for Xbox login code!`);
  }
  
  // Intercept stdout to catch login code (only for online mode)
  if (!offline_mode) {
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const loginCodeRegex = /code ([A-Z0-9]{8})/;
    let authCodeFound = false;
    
    process.stdout.write = function(chunk, encoding, callback) {
      const message = chunk.toString();
      
      // Check for login code
      if (!authCodeFound && loginCodeRegex.test(message)) {
        const codeMatch = message.match(loginCodeRegex);
        if (codeMatch) {
          const code = codeMatch[1];
          originalStdoutWrite(`\n${'='.repeat(60)}\n`);
          originalStdoutWrite(`🔐 XBOX LOGIN REQUIRED\n`);
          originalStdoutWrite(`${'='.repeat(60)}\n`);
          originalStdoutWrite(`1. Open: https://www.microsoft.com/link\n`);
          originalStdoutWrite(`2. Enter code: ${code}\n`);
          originalStdoutWrite(`3. Sign in with your Xbox/Microsoft account\n`);
          originalStdoutWrite(`${'='.repeat(60)}\n\n`);
          authCodeFound = true;
        }
      }
      
      return originalStdoutWrite(chunk, encoding, callback);
    };
    
    // Restore stdout after 60 seconds
    setTimeout(() => {
      process.stdout.write = originalStdoutWrite;
    }, 60000);
  }
  
  const client = bedrock.createClient({
    host: server_ip,
    port: server_port,
    username,
    offline: offline_mode,
  });
  
  // Debug mode: log all packets
  if (SHOP_CONFIG.debugMode) {
    client.on('packet', (packet) => {
      logDebug(`[PACKET] ${packet.data?.name || 'unknown'}`);
    });
  }
  
  client.on('spawn', () => {
    logInfo(`✓ Spawned! Waiting 5 seconds before opening shop...`);
    
    setTimeout(() => {
      logInfo(`Executing: /shop`);
      shopState.active = true;
      shopState.currentStep = 'waiting_category';
      
      try {
        client.write('command_request', {
          command: '/shop',
          origin: {
            type: 'player',
            uuid: '',
            request_id: '',
            player_entity_id: 0,
          },
          internal: false,
          version: '52',
        });
      } catch (err) {
        logError(`Failed to send command: ${err.message}`);
      }
      
      // Timeout: jika tidak ada form dalam 10 detik
      setTimeout(() => {
        if (shopState.active && shopState.currentStep === 'waiting_category') {
          logError(`⏱️ Timeout: No shop form received after 10 seconds`);
          logWarn(`Possible reasons:`);
          logWarn(`  - Server doesn't use /shop command`);
          logWarn(`  - Command format different (try /shop help)`);
          logWarn(`  - No permission to access shop`);
          logWarn(`  - Shop plugin not responding`);
          logInfo(`Try running with --debug flag to see all packets`);
          shopState.active = false;
        }
      }, 10000);
    }, 5000);
  });
  
  // Listen for modal forms
  client.on('modal_form_request', (packet) => {
    logInfo(`📋 Form received: ID ${packet.form_id}`);
    
    if (SHOP_CONFIG.debugMode) {
      logDebug(`Form data: ${packet.data}`);
    }
    
    if (shopState.active) {
      handleModalForm(client, packet);
    } else {
      logWarn(`Ignoring form (shop not active)`);
    }
  });
  
  // Listen for simple forms (alternative form type)
  client.on('simple_form_request', (packet) => {
    logInfo(`📋 Simple form received: ID ${packet.form_id}`);
    
    if (SHOP_CONFIG.debugMode) {
      logDebug(`Form data: ${packet.data}`);
    }
    
    if (shopState.active) {
      handleModalForm(client, packet);
    }
  });
  
  // Listen for server_settings (might contain form info)
  client.on('server_settings_response', (packet) => {
    if (SHOP_CONFIG.debugMode) {
      logDebug(`Server settings: ${JSON.stringify(packet)}`);
    }
  });
  
  // Listen for text messages (success/error messages)
  client.on('text', (packet) => {
    if (packet?.message) {
      const msg = packet.message.replace(/§[0-9a-zA-Z]/gi, '');
      logInfo(`[SERVER] ${msg}`);
      
      // Check for purchase success/failure
      if (msg.toLowerCase().includes('purchased') || msg.toLowerCase().includes('bought')) {
        logInfo(`✓✓✓ Purchase successful! ✓✓✓`);
      } else if (msg.toLowerCase().includes('not enough') || msg.toLowerCase().includes('insufficient')) {
        logError(`✗ Purchase failed: Not enough money/resources`);
      } else if (msg.toLowerCase().includes('error')) {
        logError(`✗ Purchase error: ${msg}`);
      }
    }
  });
  
  client.on('disconnect', (packet) => {
    logWarn(`Disconnected: ${packet?.message || 'Unknown'}`);
    process.exit(0);
  });
  
  client.on('kick', (packet) => {
    logError(`Kicked: ${packet?.message || 'Unknown'}`);
    process.exit(1);
  });
  
  client.on('close', () => {
    logWarn(`Connection closed`);
  });
  
  client.on('error', (err) => {
    logError(`Connection error: ${err.message}`);
  });
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  logInfo('Shutting down...');
  process.exit(0);
});

// Run test
testAutoShop().catch(err => {
  logError(`Test failed: ${err.message}`);
  process.exit(1);
});
