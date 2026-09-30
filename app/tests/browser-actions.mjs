import {expect} from '@playwright/test'
export async function settledMode(page){
 await expect(page.locator('.product-nav')).toBeVisible()
 if(await page.locator('body').getAttribute('data-mode')!=='kiosk')await expect(page.locator('body')).toHaveAttribute('data-mode',page.viewportSize().width<700?'mobile':'desktop')
 return page.locator('body').getAttribute('data-mode')
}
export async function routeTo(page,route){
 await settledMode(page)
 if(['meals','shopping'].includes(route)){
  await page.locator('.product-nav [data-product-route=food]').click();await page.locator('[data-food-tab='+route+']').click()
 }else await page.locator('.product-nav [data-product-route='+route+']').click()
 await expect(page.locator('body')).toHaveAttribute('data-route',route)
}
export async function openCreate(page,kind='Aktivitet',{compact=false}={}){
 await settledMode(page)
 await page.locator('#new-calendar-button').click()
 await page.locator('[data-create-kind="'+kind+'"]').click()
 if(!compact)await expandTaskAdvanced(page)
}
export async function openSettings(page,tab='people'){
 if(await settledMode(page)!=='kiosk'){await routeTo(page,'family');await page.locator('[data-open-settings='+tab+']').first().click()}
 else {await page.locator('#settings-button').click();await page.locator('[data-settings-tab='+tab+']').click()}
 await expect(page.locator('[data-settings-panel='+tab+']')).toBeVisible()
}
export async function logout(page){
 if(await settledMode(page)==='mobile'){await openSettings(page,'account');await page.locator('#account-logout').click()}
 else await page.locator('#logout-button').click()
}
export async function toggleView(page){
 if(await settledMode(page)==='mobile')await page.locator('[data-calendar-view][aria-pressed=false]').click()
 else await page.locator('#calendar-toggle-view-button').click()
}
export async function switchHousehold(page,id,returnRoute='calendar'){
 if(await settledMode(page)!=='kiosk')await routeTo(page,'family')
 await page.locator('#household-switch').selectOption(id)
 await routeTo(page,returnRoute)
}

export async function expandTaskAdvanced(page){const details=page.locator('.task-advanced');if(await details.count()&&(await details.getAttribute('open'))===null)await details.locator(':scope > summary').click()}
