import { useState } from 'react'
import { ethers } from 'ethers' // מייבאים את המתורגמן שלנו לבלוקצ'יין
import contractArtifact from './DecentralizedForum.json' // מייבאים את התפריט (ה-ABI)
import './App.css'

// הכתובת שקיבלנו מהטרמינל כשפרסנו את החוזה
const CONTRACT_ADDRESS = "0x5fbdb2315678afecb367f032d93f642f64180aa3";

function App() {
  const [walletAddress, setWalletAddress] = useState('')
  const [communityCount, setCommunityCount] = useState<string | null>(null)

  // פונקציית התחברות לארנק (כמו שכבר עשינו)
  const connectWallet = async () => {
    if (typeof (window as any).ethereum !== 'undefined') {
      try {
        const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' })
        setWalletAddress(accounts[0])
      } catch (error) {
        console.error('המשתמש סירב או שיש בעיה', error)
      }
    } else {
      alert('נראה שאין לך MetaMask מותקן. אנא התקן את התוסף!')
    }
  }

  // פונקציה חדשה! פונה לבלוקצ'יין ובודקת כמה קהילות יש
  const checkCommunities = async () => {
    if (typeof (window as any).ethereum !== 'undefined') {
      try {
        // 1. מגדירים את מטאמאסק כספק התקשורת שלנו לבלוקצ'יין
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        
        // 2. יוצרים ייצוג של החוזה: מחברים את הכתובת + ה-ABI + הספק
        const contract = new ethers.Contract(CONTRACT_ADDRESS, contractArtifact.abi, provider);

        // 3. קוראים לפונקציה מהחוזה! (לפי ה-HLD שלכם אמורה להיות פונקציה כזו)
        // שים לב שזו קריאה (Read) בלבד, לכן היא לא עולה גז ולא מקפיצה אישור במטאמאסק
        const ids = await contract.getAllCommunityIds();
        
        // שומרים את כמות הקהילות שחזרה למשתנה שלנו כדי להציג במסך
        setCommunityCount(ids.length.toString());
      } catch (err) {
        console.error("שגיאה בקריאה מהחוזה:", err);
        alert("קרתה שגיאה בקריאה מהחוזה! פתח את הקונסול (F12) כדי לראות פרטים.");
      }
    }
  }

  return (
    <div style={{ textAlign: 'center', marginTop: '50px' }}>
      <h1>Welcome to Reppit 🚀</h1>
      <h2>הרשת החברתית המבוזרת שלכם</h2>
      
      {walletAddress === '' ? (
        <button 
          style={{ padding: '10px 20px', fontSize: '18px', cursor: 'pointer', marginTop: '20px' }}
          onClick={connectWallet}
        >
          Connect Wallet
        </button>
      ) : (
        <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#2c2c2c', borderRadius: '10px', display: 'inline-block' }}>
          <h3 style={{ color: '#4caf50', margin: '0 0 10px 0' }}>✅ ארנק מחובר בהצלחה!</h3>
          <p style={{ fontFamily: 'monospace', margin: '0 0 20px 0' }}>{walletAddress}</p>
          
          {/* הכפתור החדש שקורא לבלוקצ'יין */}
          <button 
            style={{ padding: '10px 20px', fontSize: '16px', cursor: 'pointer', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px' }}
            onClick={checkCommunities}
          >
            כמה קהילות קיימות כרגע בבלוקצ'יין?
          </button>
          
          {/* מציג את התוצאה אחרי שהיא חוזרת מהבלוקצ'יין */}
          {communityCount !== null && (
            <p style={{ fontSize: '20px', marginTop: '15px', color: '#ffeb3b' }}>
              כרגע יש <b>{communityCount}</b> קהילות בבלוקצ'יין!
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default App