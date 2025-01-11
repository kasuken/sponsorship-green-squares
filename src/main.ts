import * as core from '@actions/core'
import fs from 'fs'
import { graphql } from '@octokit/graphql'
import { execSync } from 'child_process'
import { Octokit } from '@octokit/rest'

const token = process.env.GITHUB_TOKEN
const octokit = new Octokit({ auth: token })

 
interface SponsoredProfile {
  sponsorLogin: string
  sponsorshipAmount: number
  currency: string
  createdAt: string
}

async function fetchSponsoredProfiles(): Promise<SponsoredProfile[]> {
  const query = `
      query {
          viewer {
              sponsorshipsAsSponsor(first: 100) {
                  nodes {
                      sponsorable {
                          ... on User {
                              login
                          }
                          ... on Organization {
                              login
                          }
                      }
                      tier {
                          monthlyPriceInDollars
                      }
                      createdAt
                  }
              }
          }
      }
  `

  try {
    const response = await graphql({
      query,
      headers: {
        authorization: `token ${token}`
      }
    })

    const sponsoredProfiles: SponsoredProfile[] =
      response.viewer.sponsorshipsAsSponsor.nodes.map((sponsorship: any) => ({
        sponsorLogin: sponsorship.sponsorable.login,
        sponsorshipAmount: sponsorship.tier.monthlyPriceInDollars,
        currency: 'USD', // Assuming the currency is USD
        createdAt: sponsorship.createdAt
      }))

    return sponsoredProfiles
  } catch (error: any) {
    core.setFailed('Error fetching sponsored profiles:', error.message)
    return []
  }
}

async function commitIfNotDuplicate(commitMessage: string, filePath: string) {
  const repo = process.env.GITHUB_REPOSITORY
  if (!repo) {
    throw new Error('GITHUB_REPOSITORY is not defined')
  }
  const owner = repo.split('/')

  const { data: commits } = await octokit.repos.listCommits({
    owner,
    repo,
    per_page: 100
  })

  const duplicateCommit = commits.find(
    (commit: any) => commit.commit.message === commitMessage
  )

  if (!duplicateCommit) {
    // Commit the changes
    execSync('git config --global user.name "github-actions[bot]"')
    execSync(
      'git config --global user.email "github-actions[bot]@users.noreply.github.com"'
    )
    execSync(`git add ${filePath}`)
    execSync(`git commit -m "${commitMessage}"`)
    execSync('git push')
  } else {
    core.setFailed(`Duplicate commit found: ${commitMessage}`)
  }
}

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const ms: string = core.getInput('milliseconds')

    // Debug logs are only output if the `ACTIONS_STEP_DEBUG` secret is true
    core.debug(`Waiting ${ms} milliseconds ...`)

    // Log the current timestamp, wait, then log the new timestamp
    fetchSponsoredProfiles().then((data) => {
      const currentDate = new Date()
      const month = currentDate.toLocaleString('default', { month: 'long' })
      const year = currentDate.getFullYear()

      data.forEach(async (profile, index) => {
        const filePath = `sponsoredProfile_${index + 1}.json`
        fs.writeFileSync(filePath, JSON.stringify(profile, null, 2))

        const commitMessage = `${profile.sponsorshipAmount} ${profile.currency} sponsorship paid to @${profile.sponsorLogin} for ${month} ${year}`

        await commitIfNotDuplicate(commitMessage, filePath)
      })
    })

    // Set outputs for other workflow steps to use
    core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
