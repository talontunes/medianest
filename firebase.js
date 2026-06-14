// js/firebase.js  (v3 — fixes dateAdded Timestamp corruption on re-save)
// ─────────────────────────────────────────────────────────────
// Firebase initialisation. Loaded as a <script type="module">
// BEFORE main.js so that window._fb and window._fbReady are set
// before the app boots.
//
// FIXES vs v2:
//   - saveItem: preserves the original Firestore Timestamp for
//     dateAdded when editing existing items, instead of letting
//     a plain-object form of the Timestamp overwrite it. This
//     prevents the sort-breaking bug where re-saved items had
//     dateAdded as {seconds,nanoseconds} instead of a real Timestamp.
//   - saveItem: for new items, always uses serverTimestamp() (no
//     change from v2, but made explicit).
//   - getCommunityItems: wrapped in a try/catch that surfaces a
//     better message when the required Firestore composite index
//     doesn't exist yet (common on new projects).
// ─────────────────────────────────────────────────────────────

import './state.js';
import { FIREBASE_CONFIG } from './firebase-config.js';

const FIREBASE_ENABLED =
  !!FIREBASE_CONFIG.apiKey &&
  !FIREBASE_CONFIG.apiKey.startsWith('YOUR_') &&
  FIREBASE_CONFIG.apiKey.length > 10 &&
  !!FIREBASE_CONFIG.projectId &&
  !FIREBASE_CONFIG.projectId.startsWith('YOUR_');

function signalReady() {
  window._fbReady = true;
  if (typeof window._fbReadyCb === 'function') window._fbReadyCb();
}

if (!FIREBASE_ENABLED) {
  console.log('[firebase] No valid config — running in local mode');
  signalReady();
} else {
  console.log('[firebase] Real config detected — initialising Firebase…');
  (async () => {
    try {
      const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
      const {
        getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
        signOut, onAuthStateChanged, updateProfile,
      } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
      const {
        getFirestore, doc, setDoc, getDoc, collection, collectionGroup,
        addDoc, deleteDoc, getDocs, onSnapshot, serverTimestamp, orderBy,
        query, where, limit, getCountFromServer,
      } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

      const app  = initializeApp(FIREBASE_CONFIG);
      const auth = getAuth(app);
      const db   = getFirestore(app);

      let unsubscribeCollection = null;

      onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          try {
            const profSnap = await getDoc(doc(db, 'users', firebaseUser.uid));
            const prof = profSnap.exists() ? profSnap.data() : {};
            window._state.user = {
              id:        firebaseUser.uid,
              email:     firebaseUser.email,
              username:  prof.username  || firebaseUser.email.split('@')[0],
              firstName: prof.firstName || firebaseUser.displayName?.split(' ')[0] || 'User',
              lastName:  prof.lastName  || firebaseUser.displayName?.split(' ').slice(1).join(' ') || '',
              phone:     prof.phone     || null,
              joined:    prof.joined    || new Date().toISOString().split('T')[0],
            };
          } catch (profileErr) {
            console.warn('[firebase] Could not load profile:', profileErr);
            window._state.user = {
              id:        firebaseUser.uid,
              email:     firebaseUser.email,
              username:  firebaseUser.email.split('@')[0],
              firstName: 'User',
              lastName:  '',
              phone:     null,
              joined:    new Date().toISOString().split('T')[0],
            };
          }

          if (unsubscribeCollection) unsubscribeCollection();
          const colRef = collection(db, 'users', firebaseUser.uid, 'collection');
          unsubscribeCollection = onSnapshot(
            query(colRef, orderBy('dateAdded', 'desc')),
            (snap) => {
              window._state.collection = snap.docs.map(d => ({ id: d.id, ...d.data() }));
              if (window._currentPage === 'collection') window.renderCollection?.();
              if (window._currentPage === 'profile')    window.renderProfile?.();
            }
          );

          window.updateNavForAuth?.();
          window.navigate?.('collection');
        } else {
          window._state.user = null;
          if (unsubscribeCollection) { unsubscribeCollection(); unsubscribeCollection = null; }
          window._state.collection = [];
          window.updateNavForAuth?.();
          window.navigate?.('home');
        }
      });

      window._fb = {
        enabled: true,

        login:  (email, pw) => signInWithEmailAndPassword(auth, email, pw),

        signup: async (email, pw, firstName, lastName, username, phone) => {
          const cred = await createUserWithEmailAndPassword(auth, email, pw);
          await updateProfile(cred.user, { displayName: firstName + ' ' + lastName });
          const normPhone = phone ? phone.replace(/[\s\-().+]/g, '') : null;
          await setDoc(doc(db, 'users', cred.user.uid), {
            firstName, lastName, username, email,
            phone: normPhone,
            joined: new Date().toISOString().split('T')[0],
          });
          return cred;
        },

        logout: () => signOut(auth),

        // ── queryUserByIdentifier ─────────────────────────────
        queryUserByIdentifier: async (identifier) => {
          const trimmed   = identifier.trim();
          const normPhone = trimmed.replace(/[\s\-().+]/g, '');
          const usersRef  = collection(db, 'users');

          const [byUsername, byPhone] = await Promise.allSettled([
            getDocs(query(usersRef, where('username', '==', trimmed),  limit(1))),
            getDocs(query(usersRef, where('phone',    '==', normPhone), limit(1))),
          ]);

          if (byUsername.status === 'fulfilled' && !byUsername.value.empty) {
            const data = byUsername.value.docs[0].data();
            if (data.email) return data.email;
          }
          if (byPhone.status === 'fulfilled' && !byPhone.value.empty) {
            const data = byPhone.value.docs[0].data();
            if (data.email) return data.email;
          }

          const lowerTrimmed = trimmed.toLowerCase();
          if (lowerTrimmed !== trimmed) {
            try {
              const snap = await getDocs(
                query(usersRef, where('username', '==', lowerTrimmed), limit(1))
              );
              if (!snap.empty) {
                const data = snap.docs[0].data();
                if (data.email) return data.email;
              }
            } catch (_) {}
          }

          return null;
        },

        // ── saveItem ──────────────────────────────────────────
        // FIX: When editing an existing item that was loaded from Firestore,
        // its dateAdded is a Firestore Timestamp. After JSON.parse(JSON.stringify(...))
        // in openAddModal it becomes a plain object {seconds, nanoseconds}.
        // We must NOT store this plain object back — instead we use FieldValue
        // deleteField trick: just omit dateAdded from the payload on edits
        // (merge:true preserves the original Timestamp in Firestore).
        // For new items we always use serverTimestamp().
        saveItem: async (item) => {
          if (!window._state.user) return null;
          const uid      = window._state.user.id;
          const username = window._state.user.username || window._state.user.email || 'anonymous';

          // Destructure out id and dateAdded — we handle them separately
          const { id, dateAdded, ...rest } = item;

          // Determine if this is a new item (id created locally starts with 'i')
          // or an existing Firestore document
          const isNew = !id || id.startsWith('i');

          const payload = { ...rest, username, ownerId: uid };

          if (!isNew) {
            // EDIT: use setDoc with merge — omit dateAdded so Firestore keeps
            // the original Timestamp untouched. Only update if dateAdded is
            // a plain string (safe to store) or skip it otherwise.
            if (typeof dateAdded === 'string') {
              payload.dateAdded = dateAdded;
            }
            // If dateAdded is a Timestamp or plain object, don't include it —
            // Firestore already has the correct value, merge:true leaves it alone.
            await setDoc(doc(db, 'users', uid, 'collection', id), payload, { merge: true });
            return id;
          }

          // NEW item: always use serverTimestamp()
          const ref = await addDoc(collection(db, 'users', uid, 'collection'), {
            ...payload,
            dateAdded: serverTimestamp(),
          });
          return ref.id;
        },

        deleteItem: async (itemId) => {
          if (!window._state.user) return;
          await deleteDoc(doc(db, 'users', window._state.user.id, 'collection', itemId));
        },

        updateProfile: async (uid, data) =>
          setDoc(doc(db, 'users', uid), data, { merge: true }),

        saveWishlist: async (list) => {
          if (!window._state.user) return;
          await setDoc(doc(db, 'users', window._state.user.id), { wishlist: list }, { merge: true });
        },

        saveMessages: async (msgs) => {
          if (!window._state.user) return;
          await setDoc(doc(db, 'users', window._state.user.id), { messages: msgs }, { merge: true });
        },

        loadUserExtra: async () => {
          if (!window._state.user) return;
          const snap = await getDoc(doc(db, 'users', window._state.user.id));
          if (snap.exists()) {
            const d = snap.data();
            if (d.wishlist) window._state.wishlist = d.wishlist;
            if (d.messages) window._state.messages = d.messages;
            if (d.trades)   window._state.trades   = d.trades;
          }
        },

        // FIX: getCommunityItems — provides a clear error message when the
        // required composite index (dateAdded DESC across collectionGroup) is
        // missing, and falls back gracefully instead of breaking the app.
        getCommunityItems: async () => {
          try {
            const q = query(
              collectionGroup(db, 'collection'),
              orderBy('dateAdded', 'desc'),
              limit(24)
            );
            const snap = await getDocs(q);
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
          } catch (e) {
            if (e.code === 'failed-precondition' || e.message?.includes('index')) {
              console.warn(
                '[firebase] getCommunityItems: missing Firestore index.\n' +
                'Create a composite index on collectionGroup "collection" for dateAdded DESC.\n' +
                'Firebase Console → Firestore → Indexes → Add composite index.'
              );
            } else {
              console.warn('[firebase] getCommunityItems failed:', e);
            }
            return [];
          }
        },

        sendMessage: async (to, text) => {
          if (!window._state.user) return null;
          const from = window._state.user.username || window._state.user.email || 'unknown';
          return addDoc(collection(db, 'messages'), {
            from, to, text,
            participants: [from, to],
            createdAt: serverTimestamp(),
          });
        },

        subscribeToMessages: (username, cb) => {
          const q = query(
            collection(db, 'messages'),
            where('participants', 'array-contains', username),
            orderBy('createdAt', 'asc')
          );
          return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        },

        googleLogin:  async () => { throw new Error('Google Sign-In requires additional Firebase configuration'); },
        googleSignup: async () => { throw new Error('Google Sign-Up requires additional Firebase configuration'); },

        // ── getAllUsers ────────────────────────────────────────
        getAllUsers: async () => {
          try {
            const usersSnap = await getDocs(collection(db, 'users'));
            const results = await Promise.allSettled(
              usersSnap.docs.map(async (userDoc) => {
                const data = userDoc.data();
                let itemCount = 0;
                try {
                  const countSnap = await getCountFromServer(
                    collection(db, 'users', userDoc.id, 'collection')
                  );
                  itemCount = countSnap.data().count;
                } catch (_countErr) {
                  try {
                    const itemsSnap = await getDocs(
                      query(collection(db, 'users', userDoc.id, 'collection'), limit(1))
                    );
                    itemCount = itemsSnap.size;
                  } catch (_) {}
                }

                let icon = '📦';
                try {
                  const firstSnap = await getDocs(
                    query(collection(db, 'users', userDoc.id, 'collection'), limit(1))
                  );
                  if (!firstSnap.empty) icon = firstSnap.docs[0].data().icon || '📦';
                } catch (_) {}

                return {
                  id:        userDoc.id,
                  firstName: data.firstName || '',
                  lastName:  data.lastName  || '',
                  username:  data.username  || '',
                  itemCount,
                  icon,
                };
              })
            );

            return results
              .filter(r => r.status === 'fulfilled')
              .map(r => r.value);
          } catch (e) {
            console.warn('[firebase] getAllUsers failed:', e);
            return [];
          }
        },
      };

    } catch (err) {
      console.error('[firebase] Failed to initialise:', err);
    }

    signalReady();
  })();
}