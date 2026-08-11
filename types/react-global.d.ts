declare global {
  namespace React {
    type ReactNode = import('react').ReactNode
    type ReactElement = import('react').ReactElement
    type ReactNodeArray = import('react').ReactNodeArray
    type ReactFragment = import('react').ReactFragment
    type JSXElementConstructor<P = any> = import('react').JSXElementConstructor<P>
  }
}

export {}
