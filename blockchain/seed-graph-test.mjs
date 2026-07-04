import { ethers } from 'ethers'
import fs from 'fs'

const artifact = JSON.parse(fs.readFileSync('artifacts/contracts/mainContract.sol/DecentralizedForum.json', 'utf8'))
const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545')
const w1 = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider)
const w2 = new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', provider)
const addr = '0x5FbDB2315678afecb367f032d93F642f64180aa3'

const c1 = new ethers.Contract(addr, artifact.abi, w1)
const c2 = new ethers.Contract(addr, artifact.abi, w2)

const run = async () => {
  await (await c1.registerUsername('adi_dev')).wait()
  await (await c2.registerUsername('rotem_dev')).wait()
  await (await c1.createCommunity('blockchain', 'cid-demo', 'All about blockchain and web3')).wait()
  await (await c1.createPost(1, 'cid-post-1', 'Hello Graph indexing', 'solidity,thegraph')).wait()
  await (await c2.joinCommunity(1)).wait()
  await (await c2.votePost(1, 1)).wait()
  const fee = await c1.USERNAME_CHANGE_FEE()
  await (await c2.changeUsername('rotem_builder', { value: fee })).wait()
  console.log('seeded: 2 users, 1 community, 1 post, 1 upvote, 1 username change')
}

run().catch((e) => { console.error(e.message); process.exit(1) })
