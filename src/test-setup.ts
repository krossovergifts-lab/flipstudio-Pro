import { configure } from '@testing-library/react'

// Give UI waits more time on slow CI machines; locally they finish in milliseconds.
configure({ asyncUtilTimeout: 15000 })
