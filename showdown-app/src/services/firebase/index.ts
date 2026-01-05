export {
  initializeFirebase,
  getFirebaseApp,
  getFirebaseDatabase,
  getFirebaseAuth,
  isFirebaseInitialized
} from './config'

export {
  saveProject,
  loadProjects,
  deleteProject,
  saveOperators,
  loadOperators,
  updateLiveMatch,
  removeLiveMatch,
  subscribeToProjects,
  subscribeToLiveMatches,
  subscribeToOperators
} from './database'

export {
  syncManager,
  useFirebaseSync,
  mergeProjects
} from './sync'
