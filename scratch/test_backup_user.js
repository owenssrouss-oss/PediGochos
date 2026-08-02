const { createClient } = require('@supabase/supabase-js');

const url = 'https://bvdwxgfixirisqaavskj.supabase.co';
const key = 'sb_publishable_8n4-tEnAx5J98ZMh_QwZiw_Qcncleqx';

const supabase = createClient(url, key);

const email = 'pedigochos.backup@gmail.com';
const password = 'PedigochosBackup2026!';

async function run() {
  try {
    console.log('Attempting to sign in with backup agent credentials...');
    let { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (authError) {
      console.log('Sign in failed (user might not exist), attempting sign up...');
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password
      });
      
      if (signUpError) {
        console.error('Sign up failed:', signUpError.message);
        return;
      }
      
      console.log('Sign up successful! Authenticated user ID:', signUpData.user.id);
      authData = signUpData;
    } else {
      console.log('Sign in successful! Authenticated user ID:', authData.user.id);
    }
    
    // Test uploading file now
    const blob = Buffer.from(JSON.stringify({ test: true }));
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('menu_images')
      .upload('uploads/test_user_backup.json', blob, {
        contentType: 'application/json',
        upsert: true
      });
      
    if (uploadError) {
      console.error('Upload failed with backup agent auth:', uploadError.message);
    } else {
      console.log('🎉 Upload successful using backup agent auth!', uploadData);
    }
  } catch (err) {
    console.error(err);
  }
}

run();
