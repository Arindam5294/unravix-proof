import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment } from './utils'

task('deploy-unravix-proof', 'Deploy UnravixProof').setAction(async (_, hre: HardhatRuntimeEnvironment) => {
	const { ethers, network } = hre
	const [deployer] = await ethers.getSigners()
	console.log(`Deploying UnravixProof to ${network.name} from ${deployer.address}`)
	const F = await ethers.getContractFactory('UnravixProof')
	const c = await F.deploy()
	await c.waitForDeployment()
	const addr = await c.getAddress()
	console.log(`UnravixProof deployed to: ${addr}`)
	saveDeployment(network.name, 'UnravixProof', addr)
	return addr
})
