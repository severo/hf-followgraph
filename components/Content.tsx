import { Spinner } from './Spinner'
import React, { useState, memo, useRef } from 'react'
import debounce from 'debounce'
import { cp } from 'fs'

const usersCache = new Map<string, AccountDetails>()

type AccountDetails = {
  user: string
  fullname: string
  // isFollowing: boolean
  // type: "user" | "org"
  // isPro: boolean
  avatarUrl: string
  followed_by: Set<string> // list of usernames
  followers_count: number
  details: string
}

async function accountFollows(
  handle: string,
  limit: number,
  logError: (x: string) => void
): Promise<Array<AccountDetails>> {
  let nextPage:
    | string
    | null = `https://huggingface.co/api/users/${handle}/following`
  let data: Array<AccountDetails> = []
  while (nextPage && data.length <= limit) {
    console.log(`Get page: ${nextPage}`)
    let response
    let page
    try {
      response = await fetch(nextPage)
      if (response.status !== 200) {
        throw new Error('HTTP request failed')
      }
      page = await response.json()
    } catch (e) {
      logError(`Error while retrieving follows for ${handle}.`)
      break
    }
    if (!page.map) {
      break
    }
    page = page.slice(0, limit)
    // const newData = await Promise.all(
    //   page.map(async (account) => {
    //     const user = account.user
    //     if (!usersCache.has(user)) {
    //       const details = await accountDetails(user, logError)
    //       // const followers_count = await accountFollowersCount(user, logError)
    //       usersCache.set(user, { ...account, details })
    //     }
    //     return usersCache.get(user)
    //   })
    // )
    // data = [...data, ...newData]
    data = [...data, ...page]
    nextPage = getNextPage(response.headers.get('Link'))
  }
  return data
}

// async function accountFollowersCount(
//   handle: string,
//   logError: (x: string) => void
// ): Promise<number> {
//   let nextPage:
//     | string
//     | null = `https://huggingface.co/api/users/${handle}/followers`
//   let count = 0
//   while (nextPage) {
//     console.log(`Get page: ${nextPage}`)
//     let response
//     let page
//     try {
//       response = await fetch(nextPage)
//       if (response.status !== 200) {
//         throw new Error('HTTP request failed')
//       }
//       page = await response.json()
//     } catch (e) {
//       logError(`Error while retrieving followers for ${handle}.`)
//       break
//     }
//     if (!page.map) {
//       break
//     }
//     count += page.length
//     nextPage = getNextPage(response.headers.get('Link'))
//   }
//   return count
// }

async function accountDetails(
  handle: string,
  logError: (x: string) => void
): Promise<string> {
  let page
  try {
    let response = await fetch(
      `https://huggingface.co/api/users/${handle}/overview`
    )

    if (response.status !== 200) {
      throw new Error('HTTP request failed')
    }
    let page = await response.json()
    return page?.details ?? ''
  } catch (e) {
    logError(`Error while retrieving details for ${handle}.`)
  }
  return ''
}

async function accountFofs(
  handle: string,
  setProgress: (x: Array<number>) => void,
  setFollows: (x: Array<AccountDetails>) => void,
  logError: (x: string) => void
): Promise<void> {
  const directFollows = await accountFollows(handle, 2000, logError)
  setProgress([0, directFollows.length])
  let progress = 0

  const directFollowIds = new Set(directFollows.map(({ user }) => user))
  directFollowIds.add(handle)

  const indirectFollowLists: Array<Array<AccountDetails>> = []

  const updateList = debounce(() => {
    let indirectFollows: Array<AccountDetails> = [].concat(
      [],
      ...indirectFollowLists
    )
    const indirectFollowMap = new Map()

    indirectFollows
      .filter(
        // exclude direct follows
        ({ user }) => !directFollowIds.has(user)
      )
      .map((account) => {
        const acct = account.user
        if (indirectFollowMap.has(acct)) {
          const otherAccount = indirectFollowMap.get(acct)
          account.followed_by = new Set([
            ...Array.from(account.followed_by.values()),
            ...otherAccount.followed_by,
          ])
        }
        indirectFollowMap.set(acct, account)
      })

    const list = Array.from(indirectFollowMap.values()).sort((a, b) => {
      if (a.followed_by.size != b.followed_by.size) {
        return b.followed_by.size - a.followed_by.size
      }
      return b.followers_count - a.followers_count
    })

    setFollows(list)
  }, 2000)

  await Promise.all(
    directFollows.map(async ({ user }) => {
      const follows = await accountFollows(user, 200, logError)
      progress++
      setProgress([progress, directFollows.length])
      indirectFollowLists.push(
        follows.map((account) => ({ ...account, followed_by: new Set([user]) }))
      )
      updateList()
    })
  )

  updateList.flush()
}

function getNextPage(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null
  }
  // Example header:
  // Link: <https://mastodon.example/api/v1/accounts/1/follows?limit=2&max_id=7628164>; rel="next", <https://mastodon.example/api/v1/accounts/1/follows?limit=2&since_id=7628165>; rel="prev"
  const match = linkHeader.match(/<(.+)>; rel="next"/)
  if (match && match.length > 0) {
    return match[1]
  }
  return null
}

function matchesSearch(account: AccountDetails, search: string): boolean {
  if (/^\s*$/.test(search)) {
    return true
  }
  const sanitizedSearch = search.replace(/^\s+|\s+$/, '').toLocaleLowerCase()
  if (account.user.toLocaleLowerCase().includes(sanitizedSearch)) {
    return true
  }
  if (account.fullname.toLocaleLowerCase().includes(sanitizedSearch)) {
    return true
  }
  return false
}

export function Content({}) {
  const [handle, setHandle] = useState('')
  const [follows, setFollows] = useState<Array<AccountDetails>>([])
  const [isLoading, setLoading] = useState(false)
  const [isDone, setDone] = useState(false)
  const [[numLoaded, totalToLoad], setProgress] = useState<Array<number>>([
    0, 0,
  ])
  const [errors, setErrors] = useState<Array<string>>([])

  async function search(handle: string) {
    setErrors([])
    setLoading(true)
    setDone(false)
    setFollows([])
    setProgress([0, 0])
    await accountFofs(handle, setProgress, setFollows, (error) =>
      setErrors((e) => [...e, error])
    )
    setLoading(false)
    setDone(true)
  }

  return (
    <section className="bg-gray-50 dark:bg-gray-800" id="searchForm">
      <div className="px-4 py-8 mx-auto space-y-12 lg:space-y-20 lg:py-24 max-w-screen-xl">
        <form
          onSubmit={(e) => {
            search(handle)
            e.preventDefault()
            return false
          }}
        >
          <div className="form-group mb-6 text-4xl lg:ml-16">
            <label
              htmlFor="huggingFaceHandle"
              className="form-label inline-block mb-2 text-gray-700 dark:text-gray-200"
            >
              Your Hugging Face username:
            </label>
            <input
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className="form-control
        block
        w-80
        px-3
        py-1.5
        text-base
        font-normal
        text-gray-700
        bg-white bg-clip-padding
        border border-solid border-gray-300
        rounded
        transition
        ease-in-out
        m-0
        focus:text-gray-900 focus:bg-white focus:border-green-600 focus:outline-none
        dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-gray-200 dark:focus:bg-gray-900 dark:focus:text-gray-200
        "
              id="huggingFaceHandle"
              aria-describedby="huggingFaceHandleHelp"
              placeholder="merve"
            />

            <button
              type="submit"
              className="
      px-6
      py-2.5
      bg-green-600
      text-white
      font-medium
      text-xs
      leading-tight
      uppercase
      rounded
      shadow-md
      hover:bg-green-700 hover:shadow-lg
      focus:bg-green-700 focus:shadow-lg focus:outline-none focus:ring-0
      active:bg-green-800 active:shadow-lg
      transition
      duration-150
      ease-in-out"
            >
              Search
              <Spinner
                visible={isLoading}
                className="w-4 h-4 ml-2 fill-white"
              />
            </button>

            {isLoading ? (
              <p className="text-sm dark:text-gray-400">
                Loaded {numLoaded} of {totalToLoad}...
              </p>
            ) : null}

            {isDone && follows.length === 0 ? (
              <div
                className="flex p-4 mt-4 max-w-full sm:max-w-xl text-sm text-gray-700 bg-gray-100 rounded-lg dark:bg-gray-700 dark:text-gray-300"
                role="alert"
              >
                <svg
                  aria-hidden="true"
                  className="flex-shrink-0 inline w-5 h-5 mr-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fill-rule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clip-rule="evenodd"
                  ></path>
                </svg>
                <span className="sr-only">Info</span>
                <div>
                  <span className="font-medium">No results found.</span> Please
                  double check for typos in the username, and ensure that you
                  follow at least a few people to seed the search. Otherwise,
                  try again later as Hugging Face may throttle requests.
                </div>
              </div>
            ) : null}
          </div>
        </form>

        {isDone || follows.length > 0 ? <Results follows={follows} /> : null}

        <ErrorLog errors={errors} />
      </div>
    </section>
  )
}

const AccountDetails = memo(({ account }: { account: AccountDetails }) => {
  const {
    avatarUrl,
    fullname,
    user,
    followed_by,
    // followers_count,
    // details
  } = account
  // let formatter = Intl.NumberFormat('en', { notation: 'compact' })
  // let numFollowers = formatter.format(followers_count)

  const [expandedFollowers, setExpandedFollowers] = useState(false)

  return (
    <li className="px-4 py-3 pb-7 sm:px-0 sm:py-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-shrink-0 m-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="w-16 h-16 sm:w-8 sm:h-8 rounded-full"
            src={avatarUrl}
            alt={fullname}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate dark:text-white">
            {fullname}
          </p>
          {/* <div className="flex flex-col sm:flex-row text-sm text-gray-500 dark:text-gray-400">
            <span className="truncate">{user}</span>
            <span className="sm:inline hidden whitespace-pre"> | </span>
            <span>{numFollowers} followers</span>
          </div> */}
          {/* <br />
          <small className="text-sm dark:text-gray-200">{details}</small> */}
          <br />
          <small className="text-xs text-gray-800 dark:text-gray-400">
            Followed by{' '}
            {followed_by.size < 9 || expandedFollowers ? (
              Array.from<string>(followed_by.values()).map((handle, idx) => (
                <React.Fragment key={handle}>
                  <span className="font-semibold">
                    {handle.replace(/@.+/, '')}
                  </span>
                  {idx === followed_by.size - 1 ? '.' : ', '}
                </React.Fragment>
              ))
            ) : (
              <>
                <button
                  onClick={() => setExpandedFollowers(true)}
                  className="font-semibold"
                >
                  {followed_by.size} of your contacts
                </button>
                .
              </>
            )}
          </small>
        </div>
        <div className="inline-flex m-auto text-base font-semibold text-gray-900 dark:text-white">
          <a
            href={`https://huggingface.co/${user}`}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
            target="_blank"
            rel="noreferrer"
          >
            Follow
          </a>
        </div>
      </div>
    </li>
  )
})
AccountDetails.displayName = 'AccountDetails'

function ErrorLog({ errors }: { errors: Array<string> }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      {errors.length > 0 ? (
        <div className="text-sm text-gray-600 dark:text-gray-200 border border-solid border-gray-200 dark:border-gray-700 rounded p-4 max-w-4xl mx-auto">
          Found{' '}
          <button className="font-bold" onClick={() => setExpanded(!expanded)}>
            {errors.length} warnings
          </button>
          {expanded ? ':' : '.'}
          {expanded
            ? errors.map((err) => (
                <p key={err} className="text-xs">
                  {err}
                </p>
              ))
            : null}
        </div>
      ) : null}
    </>
  )
}

function Results({ follows }: { follows: Array<AccountDetails> }) {
  let [search, setSearch] = useState<string>('')
  const [isLoading, setLoading] = useState(false)
  const updateSearch = useRef(
    debounce((s: string) => {
      setLoading(false)
      setSearch(s)
    }, 1500)
  ).current

  follows = follows.filter((acc) => matchesSearch(acc, search)).slice(0, 500)

  return (
    <div className="flex-col lg:flex items-center justify-center">
      <div className="max-w-4xl">
        <div className="w-full mb-4 dark:text-gray-200">
          <label>
            <div className="mb-2">
              <Spinner
                visible={isLoading}
                className="w-4 h-4 mr-1 fill-gray-400"
              />
              Search:
            </div>
            <SearchInput
              onChange={(s) => {
                setLoading(true)
                updateSearch(s)
              }}
            />
          </label>
        </div>
        <div className="content-center px-2 sm:px-8 py-4 bg-white border rounded-lg shadow-md dark:bg-gray-800 dark:border-gray-700">
          <div className="flow-root">
            {follows.length === 0 ? (
              <p className="text-gray-700 dark:text-gray-200">
                No results found.
              </p>
            ) : null}
            <ul
              role="list"
              className="divide-y divide-gray-200 dark:divide-gray-700"
            >
              {follows.map((account) => (
                <AccountDetails key={account.user} account={account} />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

function SearchInput({ onChange }: { onChange: (s: string) => void }) {
  let [search, setSearchInputValue] = useState<string>('')
  return (
    <input
      type="text"
      placeholder="Loubna"
      value={search}
      onChange={(e) => {
        setSearchInputValue(e.target.value)
        onChange(e.target.value)
      }}
      className="
                form-control
                block
                w-80
                px-3
                py-1.5
                text-base
                font-normal
                text-gray-700
                bg-white bg-clip-padding
                border border-solid border-gray-300
                rounded
                transition
                ease-in-out
                m-0
                focus:text-gray-900 focus:bg-white focus:border-green-600 focus:outline-none
                dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-gray-200 dark:focus:bg-gray-900 dark:focus:text-gray-200"
    />
  )
}
