const fs = require('fs');
const https = require('https');
const readline = require('readline');

async function claimFaucet(address, chainId) {
  const data = JSON.stringify({ address, chainId });
  const options = {
    hostname: 'api.concero.io',
    port: 443,
    path: '/api/faucet',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    },
    timeout: 30000
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out after 30 seconds'));
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function countdown(seconds) {
  return new Promise(resolve => {
    let remaining = seconds;
    const interval = setInterval(() => {
      remaining--;
      const h = Math.floor(remaining / 3600).toString().padStart(2, '0');
      const m = Math.floor((remaining % 3600) / 60).toString().padStart(2, '0');
      const s = (remaining % 60).toString().padStart(2, '0');
      process.stdout.write(`\rNext claim in ${h}:${m}:${s}   `);
      if (remaining <= 0) {
        clearInterval(interval);
        process.stdout.write('\nStarting next claim cycle...\n');
        resolve();
      }
    }, 1000);
  });
}

function showClaimCountdown(walletNum, address, chainName, timeout) {
  let remaining = timeout;
  let interval;
  
  const update = () => {
    process.stdout.write(`\r\x1b[33m[${walletNum}]\x1b[0m Claiming for \x1b[34m${address.slice(0,6)}...${address.slice(-4)}\x1b[0m on \x1b[36m${chainName}\x1b[0m... ${remaining}s   `);
  };
  
  return {
    start: () => {
      interval = setInterval(() => {
        remaining--;
        update();
        if (remaining <= 0) clearInterval(interval);
      }, 1000);
      update();
    },
    stop: () => {
      clearInterval(interval);
      process.stdout.write('\r\x1b[K');
    }
  };
}

async function main() {
  try {
    const addresses = fs.readFileSync('address.txt', 'utf8')
      .split('\n')
      .map(a => a.trim())
      .filter(a => a.startsWith('0x'));

    const chainIds = [11155111, 421614, 84532, 43113, 6342];
    const chainNames = {
      11155111: 'Sepolia',
      421614: 'Arbitrum Sepolia',
      84532: 'Base Sepolia',
      43113: 'Avalanche Fuji',
      6342: 'MegaETH Testnet'
    };

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    async function getUserInput(query) {
      return new Promise(resolve => {
        rl.question(query, answer => {
          resolve(answer);
        });
      });
    }

    function displayChains() {
      console.log("Available chains:");
      chainIds.forEach((chainId, index) => {
        const name = chainNames[chainId] || `Chain ${chainId}`;
        console.log(`${index + 1}. ${name} (${chainId})`);
      });
    }

    let selectedChainIds = [];
    while (selectedChainIds.length === 0) {
      displayChains();
      const input = await getUserInput("Enter chain numbers separated by spaces, or 'all': ");
      
      if (input.trim().toLowerCase() === 'all') {
        selectedChainIds = chainIds;
      } else {
        selectedChainIds = input.split(' ')
          .map(n => parseInt(n))
          .filter(n => !isNaN(n) && n >= 1 && n <= chainIds.length)
          .map(n => chainIds[n - 1]);
      }
      
      if (selectedChainIds.length === 0) {
        console.log("Invalid selection. Please try again.");
      }
    }
    
    rl.close();
    
    console.log("Selected chains:");
    selectedChainIds.forEach(chainId => {
      console.log(`- ${chainNames[chainId]} (${chainId})`);
    });

    while (true) {
      for (let i = 0; i < addresses.length; i++) {
        const address = addresses[i];
        const walletNum = i + 1;
        for (const chainId of selectedChainIds) {
          const name = chainNames[chainId] || `Chain ${chainId}`;
          
          const countdown = showClaimCountdown(walletNum, address, name, 30);
          countdown.start();
          
          try {
            const response = await Promise.race([
              claimFaucet(address, chainId),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Claim attempt timed out')), 30000)
              )
            ]);
            
            countdown.stop();
            
            const statusColor = response.success ? '\x1b[32mSuccess\x1b[0m' : '\x1b[31mFailed\x1b[0m';
            const txPart = response.txHash ? ` (tx: ${response.txHash})` : '';
            const errorPart = response.errorCode ? ` (${response.errorCode})` : '';
            console.log(`\x1b[33m[${walletNum}]\x1b[0m \x1b[34m${address}\x1b[0m on \x1b[36m${name}\x1b[0m: ${statusColor} - ${response.message}${errorPart}${txPart}`);
          } catch (error) {
            countdown.stop();
            
            const errorMsg = error.message.includes('timed out') 
              ? `Claim timed out after 30 seconds` 
              : error.message;
              
            console.error(`\x1b[33m[${walletNum}]\x1b[0m \x1b[31mError\x1b[0m for \x1b[34m${address}\x1b[0m on \x1b[36m${name}\x1b[0m: ${errorMsg}`);
          }
        }
      }

      await countdown(25 * 60 * 60);
    }
  } catch (error) {
    console.error('Script error:', error.message);
  }
}

main();
