import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import contractArtifact from './DecentralizedForum.json'
import './App.css'

// ❗ שים פה את הכתובת הירוקה שקיבלת מהטרמינל ❗
const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

function App() {
  const [walletAddress, setWalletAddress] = useState('')
  
  // משתנים לקהילות
  const [communities, setCommunities] = useState<any[]>([])
  const [newCommunityName, setNewCommunityName] = useState('')
  const [newCommunityDesc, setNewCommunityDesc] = useState('') // זה ה-metadataCID

  // משתנים לפוסטים
  const [selectedCommunityId, setSelectedCommunityId] = useState('')
  const [newPostContent, setNewPostContent] = useState('') // זה ה-contentCID

  // התחברות לארנק
  const connectWallet = async () => {
    if (typeof (window as any).ethereum !== 'undefined') {
      try {
        const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' })
        setWalletAddress(accounts[0])
        loadCommunities(); // ברגע שמתחברים, טוענים את הקהילות
      } catch (error) {
        console.error('שגיאה בהתחברות', error)
      }
    } else {
      alert('אנא התקן MetaMask!')
    }
  }

  // שולף את כל הקהילות מהבלוקצ'יין
  const loadCommunities = async () => {
    if (typeof (window as any).ethereum !== 'undefined') {
      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, contractArtifact.abi, provider);
        
        // 1. מבקשים מהחוזה את המערך של כל מספרי ה-ID של הקהילות
        const ids = await contract.getAllCommunityIds();
        
        let loadedCommunities = [];
        // 2. עוברים בלולאה על כל ID, ושולפים את פרטי הקהילה הספציפית
        for (let i = 0; i < ids.length; i++) {
          const comm = await contract.getCommunity(ids[i]);
          loadedCommunities.push({
            id: comm[0].toString(),
            name: comm[1],
            metadataCID: comm[3], // התיאור
            membersCount: comm[5].toString()
          });
        }
        setCommunities(loadedCommunities);
        
        // בוחרים את הקהילה הראשונה ב-Dropdown כברירת מחדל
        if (loadedCommunities.length > 0) {
          setSelectedCommunityId(loadedCommunities[0].id);
        }
      } catch (err) {
        console.error("שגיאה בטעינת קהילות:", err);
      }
    }
  }

  // פונקציית כתיבה: יצירת קהילה
  const createCommunity = async () => {
    if (!newCommunityName || !newCommunityDesc) {
      alert("נא למלא שם ותיאור לקהילה");
      return;
    }
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner(); 
      const contract = new ethers.Contract(CONTRACT_ADDRESS, contractArtifact.abi, signer);

      // קוראים לפונקציה בחוזה שדורשת שני פרמטרים!
      const tx = await contract.createCommunity(newCommunityName, newCommunityDesc);
      
      alert("העסקה נשלחה! ממתין לאישור...");
      await tx.wait(); // מחכים שהבלוק ייסגר
      
      alert(`הקהילה "${newCommunityName}" נוצרה בהצלחה!`);
      setNewCommunityName('');
      setNewCommunityDesc('');
      loadCommunities(); // מרעננים את הרשימה
    } catch (err) {
      console.error(err);
      alert("שגיאה ביצירת הקהילה. אולי השם כבר קיים?");
    }
  }

  // פונקציית כתיבה: יצירת פוסט בקהילה נבחרת
  const createPost = async () => {
    if (!selectedCommunityId || !newPostContent) {
      alert("נא לבחור קהילה ולכתוב תוכן לפוסט");
      return;
    }
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner(); 
      const contract = new ethers.Contract(CONTRACT_ADDRESS, contractArtifact.abi, signer);

      // קוראים לפונקציה createPost בחוזה
      const tx = await contract.createPost(selectedCommunityId, newPostContent);
      
      alert("הפוסט נשלח! ממתין לאישור...");
      await tx.wait(); 
      
      alert("הפוסט פורסם בהצלחה!");
      setNewPostContent('');
    } catch (err) {
      console.error(err);
      alert("שגיאה ביצירת הפוסט. האם אתה חבר בקהילה?");
    }
  }

  return (
    <div style={{ textAlign: 'center', marginTop: '20px', paddingBottom: '50px' }}>
      <h1>ברוכים הבאים ל-Reppit 🚀</h1>
      
      {walletAddress === '' ? (
        <button onClick={connectWallet} style={{ padding: '15px 30px', fontSize: '18px', cursor: 'pointer' }}>
          התחבר עם MetaMask
        </button>
      ) : (
        <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'right', direction: 'rtl' }}>
          
          <div style={{ background: '#2c2c2c', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
            <h3 style={{ margin: 0, color: '#4caf50' }}>✅ מחובר</h3>
            <small style={{ fontFamily: 'monospace' }}>{walletAddress}</small>
          </div>

          {/* אזור יצירת קהילה */}
          <div style={{ background: '#1e1e1e', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #444' }}>
            <h2 style={{ marginTop: 0, color: '#ff4500' }}>➕ פתיחת קהילה חדשה</h2>
            <input 
              type="text" placeholder="שם הקהילה (למשל: תכנות)" 
              value={newCommunityName} onChange={(e) => setNewCommunityName(e.target.value)}
              style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '5px', boxSizing: 'border-box' }}
            />
            <input 
              type="text" placeholder="תיאור קצר (Metadata CID)" 
              value={newCommunityDesc} onChange={(e) => setNewCommunityDesc(e.target.value)}
              style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '5px', boxSizing: 'border-box' }}
            />
            <button onClick={createCommunity} style={{ width: '100%', padding: '10px', background: '#ff4500', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '16px' }}>
              צור קהילה
            </button>
          </div>

          {/* הצגת הקהילות הקיימות */}
          <div style={{ background: '#1e1e1e', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #444' }}>
            <h2 style={{ marginTop: 0, color: '#00bcd4' }}>🌐 קהילות פעילות ({communities.length})</h2>
            {communities.length === 0 ? <p>אין עדיין קהילות. צור אחת!</p> : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {communities.map((c) => (
                  <li key={c.id} style={{ background: '#333', margin: '10px 0', padding: '10px', borderRadius: '5px' }}>
                    <b>{c.name}</b> (ID: {c.id}) - <i>{c.metadataCID}</i> <br/>
                    <small>חברים בקהילה: {c.membersCount}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* אזור יצירת פוסט */}
          <div style={{ background: '#1e1e1e', padding: '20px', borderRadius: '8px', border: '1px solid #444' }}>
            <h2 style={{ marginTop: 0, color: '#4caf50' }}>📝 פרסום פוסט חדש</h2>
            
            <select 
              value={selectedCommunityId} 
              onChange={(e) => setSelectedCommunityId(e.target.value)}
              style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '5px' }}
            >
              <option value="" disabled>בחר קהילה...</option>
              {communities.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <textarea 
              placeholder="מה בא לך לשתף? (Content CID)" 
              value={newPostContent} onChange={(e) => setNewPostContent(e.target.value)}
              style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '5px', boxSizing: 'border-box', minHeight: '80px' }}
            />
            <button onClick={createPost} style={{ width: '100%', padding: '10px', background: '#4caf50', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '16px' }}>
              פרסם פוסט!
            </button>
          </div>

        </div>
      )}
    </div>
  )
}

export default App